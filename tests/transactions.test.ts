import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import bs58 from 'bs58';
import * as ed25519 from '@noble/ed25519';
import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit';
import { BLOCKHASH, call, mockRpc, spawnServer, type Harness, type MockHttp } from './helpers.js';

const RECIPIENT = '11111111111111111111111111111112';

function decode(base64: string) {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64));
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (msg.version === 1) throw new Error('unexpected v1');
  return { tx, msg };
}

describe('wallet tool', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await spawnServer();
  });

  afterAll(async () => {
    await h?.close();
  });

  it('generates, signs a verifiable message, and reports status', async () => {
    const gen = await call(h.client, 'wallet', { action: 'generate' });
    expect(gen.isError).toBe(false);
    expect(gen.json.persisted).toBe(true);
    expect(existsSync(join(h.home, '.orbitflare', 'mcp-keypair.json'))).toBe(true);

    const status = await call(h.client, 'wallet', { action: 'status' });
    expect(status.json).toMatchObject({ loaded: true, address: gen.json.address });

    const signed = await call(h.client, 'wallet', { action: 'signMessage', message: 'orbitflare-mcp-test' });
    expect(signed.json.publicKey).toBe(gen.json.address);
    const ok = await ed25519.verifyAsync(
      bs58.decode(signed.json.signatureBase58),
      new TextEncoder().encode('orbitflare-mcp-test'),
      bs58.decode(signed.json.publicKey),
    );
    expect(ok).toBe(true);
  });

  it('needs confirm before deleting the keypair file', async () => {
    const file = join(h.home, '.orbitflare', 'mcp-keypair.json');
    const preview = await call(h.client, 'wallet', { action: 'clear', removeFromDisk: true });
    expect(preview.json.confirmed).toBe(false);
    expect(preview.text).toMatch(/confirm: true/);
    expect(existsSync(file)).toBe(true);
    expect((await call(h.client, 'wallet', { action: 'status' })).json.loaded).toBe(true);

    const cleared = await call(h.client, 'wallet', { action: 'clear', removeFromDisk: true, confirm: true });
    expect(cleared.json).toEqual({ loaded: false, removedFromDisk: true });
    expect(existsSync(file)).toBe(false);
  });

  it('clearing from memory only needs no confirm', async () => {
    await call(h.client, 'wallet', { action: 'generate', persist: false });
    const cleared = await call(h.client, 'wallet', { action: 'clear' });
    expect(cleared.json.loaded).toBe(false);
  });

  it('loads a base58 secret', async () => {
    const secret = ed25519.utils.randomSecretKey();
    const pub = await ed25519.getPublicKeyAsync(secret);
    const res = await call(h.client, 'wallet', { action: 'load', base58Secret: bs58.encode(secret) });
    expect(res.json.address).toBe(bs58.encode(pub));
  });

  it('signMessage and builders error without a wallet', async () => {
    await call(h.client, 'wallet', { action: 'clear' });
    const sig = await call(h.client, 'wallet', { action: 'signMessage', message: 'x' });
    expect(sig.isError).toBe(true);
    expect(sig.text).toMatch(/No wallet keypair loaded/);
    const build = await call(h.client, 'buildSolTransfer', { recipient: RECIPIENT, amountSol: 0.1 });
    expect(build.isError).toBe(true);
    expect(build.text).toMatch(/No wallet keypair loaded/);
  });
});

describe('transaction tools (mock RPC)', () => {
  let rpc: MockHttp;
  let h: Harness;
  let address: string;

  beforeAll(async () => {
    rpc = await mockRpc({
      getLatestBlockhash: () => BLOCKHASH,
      simulateTransaction: () => ({ context: { slot: 5 }, value: { err: null, logs: ['Program log: ok'], unitsConsumed: 150 } }),
      sendTransaction: (params) => {
        const { tx } = decode(params[0]);
        return bs58.encode(Object.values(tx.signatures)[0] as Uint8Array);
      },
      getSignatureStatuses: () => ({ context: { slot: 6 }, value: [{ slot: 6, confirmationStatus: 'confirmed', err: null }] }),
    });
    h = await spawnServer({ ORBITFLARE_API_KEY: 'k', ORBITFLARE_RPC_URL: rpc.url });
    address = (await call(h.client, 'wallet', { action: 'generate', persist: false })).json.address;
  });

  afterAll(async () => {
    await h?.close();
    await rpc?.close();
  });

  beforeEach(() => {
    rpc.requests.length = 0;
  });

  it('buildSolTransfer adds compute-budget instructions and the transfer', async () => {
    const res = await call(h.client, 'buildSolTransfer', {
      recipient: RECIPIENT,
      amountSol: 0.25,
      priorityFeeMicroLamports: 5000,
      computeUnitLimit: 1000,
    });
    expect(res.json).toMatchObject({ feePayer: address, lamports: '250000000', blockhash: BLOCKHASH.value.blockhash });
    const { tx, msg } = decode(res.json.transaction);
    expect(Object.values(tx.signatures).every((s) => s === null)).toBe(true);
    const programs = msg.instructions.map((ix) => msg.staticAccounts[ix.programAddressIndex]);
    expect(programs).toEqual([
      'ComputeBudget111111111111111111111111111111',
      'ComputeBudget111111111111111111111111111111',
      '11111111111111111111111111111111',
    ]);
    expect(Array.from(msg.instructions[1].data!)).toEqual([3, 136, 19, 0, 0, 0, 0, 0, 0]);
  });


  it('simulateTransaction replaces the blockhash for unsigned transactions', async () => {
    const built = await call(h.client, 'buildSolTransfer', { recipient: RECIPIENT, amountSol: 0.1 });
    const res = await call(h.client, 'simulateTransaction', { transaction: built.json.transaction });
    expect(res.json).toMatchObject({ success: true, unitsConsumed: 150, logs: ['Program log: ok'] });
    expect(res.json.transaction.solTransfers[0]).toMatchObject({ from: address, to: RECIPIENT, sol: '0.1' });
    expect(rpc.rpc('simulateTransaction')[0].json.params[1]).toMatchObject({ sigVerify: false, replaceRecentBlockhash: true });
  });

  it('sendTransaction without confirm only previews', async () => {
    const built = await call(h.client, 'buildSolTransfer', { recipient: RECIPIENT, amountSol: 0.1 });
    rpc.requests.length = 0;
    const res = await call(h.client, 'sendTransaction', { transaction: built.json.transaction });
    expect(res.isError).toBe(false);
    expect(res.json.confirmed).toBe(false);
    expect(res.json.wouldDo).toMatch(/sign with .* and send this transaction via OrbitFlare RPC, moving 0.1 SOL/);
    expect(res.json.transaction).toMatchObject({ feePayer: address, willSignWithLoadedWallet: true, stillMissingSignatures: [] });
    expect(res.json.simulation.success).toBe(true);
    expect(rpc.rpc('sendTransaction')).toHaveLength(0);
  });

  it('sendTransaction with confirm signs, sends and waits for confirmation', async () => {
    const built = await call(h.client, 'buildSolTransfer', { recipient: RECIPIENT, amountSol: 0.1 });
    const res = await call(h.client, 'sendTransaction', { transaction: built.json.transaction, confirm: true, waitForConfirmation: true });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ via: 'rpc', signedBy: address, confirmation: { status: 'confirmed', slot: 6 } });
    const [sent] = rpc.rpc('sendTransaction');
    expect(sent.json.params[1]).toMatchObject({ encoding: 'base64', skipPreflight: false });
    const { tx } = decode(sent.json.params[0]);
    const sig = tx.signatures[address as keyof typeof tx.signatures] as Uint8Array;
    expect(await ed25519.verifyAsync(sig, new Uint8Array(tx.messageBytes), bs58.decode(address))).toBe(true);
    expect(res.json.signature).toBe(bs58.encode(sig));
  });

  it('sendTransaction refuses transactions the wallet cannot fully sign', async () => {
    const built = await call(h.client, 'buildSolTransfer', { recipient: RECIPIENT, amountSol: 0.1 });
    await call(h.client, 'wallet', { action: 'generate', persist: false });
    const res = await call(h.client, 'sendTransaction', { transaction: built.json.transaction, confirm: true });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/missing signatures from/);
    expect(rpc.rpc('sendTransaction')).toHaveLength(0);
  });

  it('rejects garbage input clearly', async () => {
    const res = await call(h.client, 'sendTransaction', { transaction: 'AQID'.repeat(15) });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Not a valid base-64 Solana transaction/);
  });
});
