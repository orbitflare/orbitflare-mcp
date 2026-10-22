import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AccountRole, address, type Address, type Instruction } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { pickApexTipAccount } from '@orbitflare/sdk/apex';
import { getNetwork } from '../config.js';
import { apexRegionSchema, checkApexTip, getApexTipAccounts, sendViaApex } from '../utils/apex.js';
import { asJson, lamportsToSol, needsConfirmation } from '../utils/formatters.js';
import { requireSigner } from '../utils/keypair.js';
import { rpcCall } from '../utils/rpc.js';
import {
  buildUnsignedTransaction,
  describeTransaction,
  signatureOf,
  signWithLoadedWallet,
} from '../utils/transactions.js';
import { confirmSchema, defineTool, DESTRUCTIVE, READ } from './define.js';

const COMPUTE_BUDGET = address('ComputeBudget111111111111111111111111111111');

function computeBudgetInstructions(microLamports?: number, unitLimit?: number): Instruction[] {
  const out: Instruction[] = [];
  if (unitLimit !== undefined) {
    const data = new Uint8Array(5);
    data[0] = 2;
    new DataView(data.buffer).setUint32(1, unitLimit, true);
    out.push({ programAddress: COMPUTE_BUDGET, data });
  }
  if (microLamports !== undefined) {
    const data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, BigInt(microLamports), true);
    out.push({ programAddress: COMPUTE_BUDGET, data });
  }
  return out;
}

const priorityInputs = {
  priorityFeeMicroLamports: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .optional()
    .describe('Compute-unit price in micro-lamports (see getPriorityFees). Adds a ComputeBudget instruction.'),
  computeUnitLimit: z.number().int().min(300).max(1_400_000).optional().describe('Compute-unit limit to request'),
};

async function simulate(transaction: string, sigVerify = false, replaceRecentBlockhash?: boolean) {
  const result = await rpcCall<{
    context: { slot: number };
    value: {
      err: unknown;
      logs: string[] | null;
      unitsConsumed?: number;
      returnData?: unknown;
      replacementBlockhash?: unknown;
      innerInstructions?: unknown;
    };
  }>('simulateTransaction', [
    transaction,
    {
      encoding: 'base64',
      commitment: 'confirmed',
      sigVerify,
      replaceRecentBlockhash: replaceRecentBlockhash ?? !sigVerify,
    },
  ]);
  const v = result.value;
  return {
    slot: result.context.slot,
    success: v.err === null || v.err === undefined,
    error: v.err ?? null,
    unitsConsumed: v.unitsConsumed ?? null,
    logs: v.logs ?? [],
    ...(v.returnData ? { returnData: v.returnData } : {}),
    ...(v.innerInstructions ? { innerInstructions: v.innerInstructions } : {}),
  };
}

async function waitForSignature(signature: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await rpcCall<{ value: ({ confirmationStatus?: string; err: unknown; slot: number } | null)[] }>(
      'getSignatureStatuses',
      [[signature]],
    ).catch(() => null);
    const status = res?.value?.[0];
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
      return { status: status.err ? 'failed' : status.confirmationStatus, slot: status.slot, error: status.err ?? null };
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return { status: 'not confirmed yet', note: 'Check again with getTransaction.' };
}

export function registerTransactionTools(server: McpServer): void {
  defineTool(
    server,
    'buildSolTransfer',
    {
      title: 'Build SOL Transfer',
      description:
        'Builds an unsigned base-64 v0 transaction that sends SOL from the loaded wallet to a recipient (the wallet pays fees). Optional priority fee, and apexTipLamports adds the tip needed to send it through OrbitFlare Apex. Nothing is signed or sent; pass the result to sendTransaction.',
      input: {
        recipient: z.string().min(32).max(44).describe('Destination address'),
        amountSol: z.number().positive().max(10000).describe('Amount of SOL to send'),
        apexTipLamports: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Add an Apex tip of this many lamports to a random Apex tip account, so it can be sent with sendTransaction via "apex". Standard-tier floor is 1000000 (0.001 SOL)',
          ),
        ...priorityInputs,
      },
      annotations: READ,
    },
    async ({ recipient, amountSol, apexTipLamports, priorityFeeMicroLamports, computeUnitLimit }) => {
      const signer = requireSigner();
      const tipAccount = apexTipLamports !== undefined ? pickApexTipAccount(await getApexTipAccounts()) : undefined;
      const lamports = BigInt(Math.round(amountSol * 1_000_000_000));
      const instructions: Instruction[] = [
        ...computeBudgetInstructions(priorityFeeMicroLamports, computeUnitLimit),
        getTransferSolInstruction({ source: signer, destination: address(recipient), amount: lamports }),
        ...(tipAccount
          ? [getTransferSolInstruction({ source: signer, destination: address(tipAccount), amount: BigInt(apexTipLamports!) })]
          : []),
      ];
      const built = await buildUnsignedTransaction(signer.address, instructions);
      return asJson(
        {
          ...built,
          feePayer: signer.address,
          recipient,
          amountSol,
          lamports: lamports.toString(),
          ...(tipAccount ? { apexTip: { account: tipAccount, lamports: String(apexTipLamports) } } : {}),
          ...(priorityFeeMicroLamports !== undefined ? { priorityFeeMicroLamports } : {}),
        },
        'Unsigned transaction built. Review it, then call sendTransaction (it signs with the loaded wallet and asks for confirmation).',
      );
    },
  );

  defineTool(
    server,
    'simulateTransaction',
    {
      title: 'Simulate Transaction',
      description:
        'Simulates a base-64 transaction (signed or unsigned) against current chain state without sending it. Returns success or the error, compute units consumed and program logs. Unsigned transactions get a fresh blockhash automatically.',
      input: {
        transaction: z.string().min(40).describe('Base-64 encoded transaction'),
        sigVerify: z.boolean().optional().describe('Verify signatures (default false; needs a fully signed transaction)'),
        replaceRecentBlockhash: z.boolean().optional().describe('Default true unless sigVerify is set'),
        innerInstructions: z.boolean().optional().describe('Include inner instructions'),
      },
      annotations: READ,
    },
    async ({ transaction, sigVerify, replaceRecentBlockhash, innerInstructions }) => {
      const sim = await simulate(transaction, sigVerify ?? false, replaceRecentBlockhash);
      if (!innerInstructions) delete (sim as { innerInstructions?: unknown }).innerInstructions;
      return asJson({ ...sim, transaction: describeTransaction(transaction) });
    },
  );

  defineTool(
    server,
    'sendTransaction',
    {
      title: 'Send Transaction',
      description:
        'Sends a base-64 transaction to Solana. If it still needs the loaded wallet\'s signature it is signed first. via "rpc" (default) broadcasts through OrbitFlare RPC; via "apex" races it to the leaders through OrbitFlare Apex (needs an Apex API key and an Apex tip, e.g. buildSolTransfer with apexTipLamports). Moves funds: without confirm: true it only decodes the transaction, simulates it and explains what would happen.',
      input: {
        transaction: z.string().min(40).describe('Base-64 encoded transaction, unsigned or signed'),
        via: z.enum(['rpc', 'apex']).optional().describe('Default rpc'),
        confirm: confirmSchema,
        skipPreflight: z.boolean().optional().describe('RPC only: skip preflight simulation (default false)'),
        maxRetries: z.number().int().min(0).max(10).optional().describe('Resend budget before the blockhash expires'),
        apexRegion: apexRegionSchema,
        mevProtect: z.boolean().optional().describe('Apex only: skip leaders on the Shield blocklist (default false)'),
        waitForConfirmation: z.boolean().optional().describe('Poll up to 30s for confirmed status (default false)'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ transaction, via, confirm, skipPreflight, maxRetries, apexRegion, mevProtect, waitForConfirmation }) => {
      const route = via ?? 'rpc';
      if (route === 'apex' && getNetwork() === 'devnet') {
        throw new Error('Apex lands transactions on mainnet only. Use via "rpc" on devnet.');
      }
      if (confirm !== true) {
        const description = describeTransaction(transaction);
        const [simulation, apexTip] = await Promise.all([
          simulate(transaction).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) })),
          route === 'apex'
            ? checkApexTip([transaction], apexRegion).catch((e: unknown) => ({
                error: e instanceof Error ? e.message : String(e),
              }))
            : Promise.resolve(undefined),
        ]);
        const outgoing = description.solTransfers
          .filter((t) => t.fromIsSigner)
          .reduce((sum, t) => sum + BigInt(t.lamports), 0n);
        return needsConfirmation(
          `Would ${description.willSignWithLoadedWallet ? `sign with ${description.loadedWallet} and ` : ''}send this transaction via ${route === 'apex' ? 'OrbitFlare Apex' : 'OrbitFlare RPC'}, moving ${lamportsToSol(outgoing)} SOL in direct SOL transfers plus fees and any program-level transfers.`,
          { transaction: description, simulation, ...(apexTip ? { apexTip } : {}) },
        );
      }

      const { transaction: signed, signedBy } = await signWithLoadedWallet(transaction);
      let result: Record<string, unknown>;
      if (route === 'apex') {
        result = { via: 'apex', ...(await sendViaApex(signed, { region: apexRegion, mevProtect, maxRetries })) };
      } else {
        const signature = await rpcCall<string>('sendTransaction', [
          signed,
          { encoding: 'base64', skipPreflight: skipPreflight ?? false, maxRetries, preflightCommitment: 'confirmed' },
        ]);
        const cluster = getNetwork() === 'devnet' ? '?cluster=devnet' : '';
        result = { via: 'rpc', signature, explorer: `https://solscan.io/tx/${signature}${cluster}` };
      }
      const signature = String(result.signature ?? signatureOf(signed));
      return asJson(
        {
          ...result,
          signedBy,
          ...(waitForConfirmation ? { confirmation: await waitForSignature(signature) } : {}),
        },
        waitForConfirmation
          ? 'Transaction submitted.'
          : 'Transaction submitted. A signature means accepted, not landed: confirm with getTransaction.',
      );
    },
  );
}
