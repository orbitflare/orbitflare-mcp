import { z } from 'zod';
import {
  APEX_MIN_TIP_LAMPORTS,
  APEX_REGIONS,
  ApexClientBuilder,
  type ApexClient,
  type ApexRegion,
} from '@orbitflare/sdk/apex';
import { getApexApiKey, getApexUrl, MissingApiKeyError } from '../config.js';
import { sdkLogger } from './logger.js';
import { decodeTransaction, signerStatus, systemTransfers } from './transactions.js';

export const TIP_RULE =
  'Every Apex transaction (or bundle) needs exactly one top-level SystemProgram transfer to an Apex tip account (apexGetTipAccounts, all start with "APeX"), funded by a signer, with the tip account in the static account keys (not an address lookup table), at or above your tier floor (0.001 SOL = 1,000,000 lamports on the standard tier). The tip is only paid if the transaction lands.';

export const apexRegionSchema = z
  .enum(APEX_REGIONS as unknown as [ApexRegion, ...ApexRegion[]])
  .optional()
  .describe(
    'Apex endpoint: fra, ams, dub, lon, nyc, slc, sgp, tyo, sqq, or global (nearest healthy endpoint). Defaults to ORBITFLARE_APEX_REGION, else global.',
  );

export function apexClient(region?: ApexRegion, requireKey = true): ApexClient {
  const apiKey = getApexApiKey();
  if (!apiKey && requireKey) throw new MissingApiKeyError('apex');
  return new ApexClientBuilder()
    .url(getApexUrl(region))
    .apiKey(apiKey ?? 'none')
    .timeoutMs(10_000)
    .logger(sdkLogger)
    .build();
}

const tipAccountsCache = new Map<string, Promise<string[]>>();

export function getApexTipAccounts(region?: ApexRegion): Promise<string[]> {
  const url = getApexUrl(region);
  let cached = tipAccountsCache.get(url);
  if (!cached) {
    cached = apexClient(region, false).getTipAccounts();
    tipAccountsCache.set(url, cached);
    cached.catch(() => tipAccountsCache.delete(url));
  }
  return cached;
}

export interface ApexTip {
  account: string;
  lamports: string;
  source: string;
  sourceIsSigner: boolean;
}

export function findApexTips(base64Tx: string, tipAccounts: readonly string[]): ApexTip[] {
  return systemTransfers(decodeTransaction(base64Tx))
    .filter((t) => tipAccounts.includes(t.to))
    .map((t) => ({ account: t.to, lamports: t.lamports, source: t.from, sourceIsSigner: t.fromIsSigner }));
}

export interface ApexTipCheck {
  tip: ApexTip & { transactionIndex: number };
  warning?: string;
}

export async function checkApexTip(
  base64Txs: string[],
  region?: ApexRegion,
): Promise<ApexTipCheck> {
  const tipAccounts = await getApexTipAccounts(region);
  const tips = base64Txs.flatMap((tx, transactionIndex) => {
    let found: ApexTip[];
    try {
      found = findApexTips(tx, tipAccounts);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`Transaction ${transactionIndex}: ${cause}`);
    }
    return found.map((t) => ({ ...t, transactionIndex }));
  });
  const scope = base64Txs.length > 1 ? 'Bundle' : 'Transaction';

  if (tips.length === 0) {
    throw new Error(
      `${scope} has no Apex tip, so Apex would reject it. ${TIP_RULE} Add the tip before signing (buildSolTransfer can add it via apexTipLamports).`,
    );
  }
  if (tips.length > 1) {
    throw new Error(
      `${scope} has ${tips.length} Apex tip transfers; exactly one is allowed. ${TIP_RULE}`,
    );
  }
  const [tip] = tips;
  if (!tip.sourceIsSigner) {
    throw new Error(`The Apex tip is funded by ${tip.source}, which does not sign the transaction. ${TIP_RULE}`);
  }
  const warning =
    BigInt(tip.lamports) < BigInt(APEX_MIN_TIP_LAMPORTS)
      ? `Tip of ${tip.lamports} lamports is below the standard-tier floor of ${APEX_MIN_TIP_LAMPORTS}; Apex will reject it unless your key's tier has a lower floor.`
      : undefined;
  return { tip, warning };
}

export function requireFullySigned(base64Txs: string[]): void {
  base64Txs.forEach((tx, i) => {
    const missing = signerStatus(decodeTransaction(tx))
      .filter((s) => !s.signed)
      .map((s) => s.address);
    if (missing.length) {
      const which = base64Txs.length > 1 ? `Transaction ${i}` : 'The transaction';
      throw new Error(
        `${which} is missing signatures from ${missing.join(', ')}; Apex only accepts fully signed transactions. To sign with the loaded wallet and send through Apex, use sendTransaction with via "apex".`,
      );
    }
  });
}

export async function sendViaApex(
  signedTransaction: string,
  opts: { region?: ApexRegion; mevProtect?: boolean; maxRetries?: number } = {},
) {
  const client = apexClient(opts.region);
  requireFullySigned([signedTransaction]);
  const { tip, warning } = await checkApexTip([signedTransaction], opts.region);
  const signature = await client.sendTransaction(signedTransaction, {
    mevProtect: opts.mevProtect,
    maxRetries: opts.maxRetries,
  });
  return {
    signature,
    endpoint: getApexUrl(opts.region),
    mevProtect: opts.mevProtect ?? false,
    tip: { account: tip.account, lamports: tip.lamports },
    ...(warning ? { warning } : {}),
    explorer: `https://solscan.io/tx/${signature}`,
  };
}
