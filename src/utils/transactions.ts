import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type ReadonlyUint8Array,
  type Transaction,
} from '@solana/kit';
import { getActiveSigner } from './keypair.js';
import { lamportsToSol } from './formatters.js';
import { withRpc } from './rpc.js';

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const SYSTEM_TRANSFER = 2;

export interface DecodedInstruction {
  program: string | undefined;
  accounts: (string | undefined)[];
  accountIndices: number[];
  data: ReadonlyUint8Array;
}

export interface DecodedTransaction {
  tx: Transaction;
  version: string;
  feePayer: string;
  staticAccounts: string[];
  numSigners: number;
  recentBlockhash: string;
  instructions: DecodedInstruction[];
  usesLookupTables: boolean;
}

export function decodeTransaction(base64Tx: string): DecodedTransaction {
  let tx: Transaction;
  let msg: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>['decode']>;
  try {
    tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64Tx));
    msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Not a valid base-64 Solana transaction: ${cause}`);
  }
  const keys = msg.staticAccounts as string[];
  const raw =
    msg.version === 1
      ? msg.instructionHeaders.map((h, i) => ({
          program: h.programAccountIndex,
          accounts: msg.instructionPayloads[i].instructionAccountIndices,
          data: msg.instructionPayloads[i].instructionData,
        }))
      : msg.instructions.map((ix) => ({
          program: ix.programAddressIndex,
          accounts: ix.accountIndices ?? [],
          data: ix.data ?? new Uint8Array(),
        }));
  return {
    tx,
    version: String(msg.version),
    feePayer: keys[0],
    staticAccounts: keys,
    numSigners: msg.header.numSignerAccounts,
    recentBlockhash: msg.lifetimeToken,
    usesLookupTables: 'addressTableLookups' in msg && (msg.addressTableLookups?.length ?? 0) > 0,
    instructions: raw.map((ix) => ({
      program: keys[ix.program],
      accounts: Array.from(ix.accounts, (i) => keys[i]),
      accountIndices: Array.from(ix.accounts),
      data: ix.data,
    })),
  };
}

export interface SolTransfer {
  from: string;
  to: string;
  lamports: string;
  sol: string;
  fromIsSigner: boolean;
}

export function systemTransfers(decoded: DecodedTransaction): SolTransfer[] {
  const out: SolTransfer[] = [];
  for (const ix of decoded.instructions) {
    if (ix.program !== SYSTEM_PROGRAM || ix.data.length !== 12 || ix.accounts.length < 2) continue;
    const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
    if (view.getUint32(0, true) !== SYSTEM_TRANSFER) continue;
    const lamports = view.getBigUint64(4, true);
    out.push({
      from: ix.accounts[0] ?? 'lookup-table account',
      to: ix.accounts[1] ?? 'lookup-table account',
      lamports: lamports.toString(),
      sol: lamportsToSol(lamports),
      fromIsSigner: ix.accountIndices[0] < decoded.numSigners,
    });
  }
  return out;
}

export function signerStatus(decoded: DecodedTransaction): { address: string; signed: boolean }[] {
  return Object.entries(decoded.tx.signatures).map(([address, sig]) => ({ address, signed: sig !== null }));
}

export function describeTransaction(base64Tx: string) {
  const decoded = decodeTransaction(base64Tx);
  const wallet = getActiveSigner()?.address ?? null;
  const signers = signerStatus(decoded);
  const missing = signers.filter((s) => !s.signed).map((s) => s.address);
  return {
    version: decoded.version,
    feePayer: decoded.feePayer,
    recentBlockhash: decoded.recentBlockhash,
    signers,
    loadedWallet: wallet,
    willSignWithLoadedWallet: wallet !== null && missing.includes(wallet),
    stillMissingSignatures: missing.filter((a) => a !== wallet),
    programs: [...new Set(decoded.instructions.map((ix) => ix.program ?? 'lookup-table program'))],
    instructionCount: decoded.instructions.length,
    solTransfers: systemTransfers(decoded),
  };
}

export async function signWithLoadedWallet(base64Tx: string): Promise<{ transaction: string; signedBy: string | null }> {
  const decoded = decodeTransaction(base64Tx);
  const signer = getActiveSigner();
  const missing = signerStatus(decoded)
    .filter((s) => !s.signed)
    .map((s) => s.address);
  if (missing.length === 0) return { transaction: base64Tx, signedBy: null };
  if (!signer || !missing.includes(signer.address)) {
    throw new Error(
      `Transaction is missing signatures from ${missing.join(', ')}` +
        (signer ? `; the loaded wallet ${signer.address} is not one of its signers.` : ' and no wallet keypair is loaded.'),
    );
  }
  const others = missing.filter((a) => a !== signer.address);
  if (others.length > 0) {
    throw new Error(`After signing with ${signer.address}, the transaction still needs signatures from ${others.join(', ')}.`);
  }
  const signed = await partiallySignTransaction([signer.keyPair], decoded.tx);
  return { transaction: getBase64EncodedWireTransaction(signed), signedBy: signer.address };
}

export function signatureOf(base64Tx: string): string | null {
  const decoded = decodeTransaction(base64Tx);
  const first = decoded.tx.signatures[decoded.feePayer as Address];
  return first ? getBase58Decoder().decode(first) : null;
}

export async function buildUnsignedTransaction(feePayer: Address, instructions: Instruction[]) {
  const { blockhash, lastValidBlockHeight } = await withRpc((c) => c.getLatestBlockhash());
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: blockhash as Blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return {
    transaction: getBase64EncodedWireTransaction(compileTransaction(message)),
    blockhash,
    lastValidBlockHeight,
  };
}
