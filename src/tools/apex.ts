import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { APEX_MIN_TIP_LAMPORTS, APEX_REGIONS, pickApexTipAccount, type ApexRegion } from '@orbitflare/sdk/apex';
import { getBase64Encoder } from '@solana/kit';
import { getApexUrl, hasApexUrlOverride } from '../config.js';
import {
  apexClient,
  apexRegionSchema,
  checkApexTip,
  getApexTipAccounts,
  requireFullySigned,
  sendViaApex,
  TIP_RULE,
} from '../utils/apex.js';
import { asJson, needsConfirmation } from '../utils/formatters.js';
import { describeTransaction } from '../utils/transactions.js';
import { confirmSchema, defineTool, DESTRUCTIVE, READ } from './define.js';

async function ping(region?: ApexRegion) {
  const client = apexClient(region, false);
  const endpoint = getApexUrl(region);
  try {
    await client.ping();
    const start = performance.now();
    await client.ping();
    return { region: region ?? null, endpoint, ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { region: region ?? null, endpoint, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function registerApexTools(server: McpServer): void {
  defineTool(
    server,
    'apexSendTransaction',
    {
      title: 'Send Signed Transaction via Apex',
      description: `Submits an already fully-signed transaction through OrbitFlare Apex, which races it to the upcoming leaders over stake-weighted connections, Jito and direct TPU at once. Needs an Apex API key (ORBITFLARE_APEX_API_KEY or setApiKey kind="apex"). ${TIP_RULE} The tip is checked before sending. sendTransaction with via "apex" does the same and can also sign. Without confirm: true it only checks the tip and explains what would be sent. A returned signature means accepted, not landed: confirm with getTransaction.`,
      input: {
        signedTransaction: z.string().min(40).describe('Base-64 fully-signed transaction that already contains the Apex tip'),
        region: apexRegionSchema,
        mevProtect: z
          .boolean()
          .optional()
          .describe('Skip leaders on the Shield blocklist (for swaps / sandwichable trades). Can land slower. Default false'),
        maxRetries: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Cap on Apex resends. Leave unset to let Apex retry until the blockhash expires'),
        confirm: confirmSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ signedTransaction, region, mevProtect, maxRetries, confirm }) => {
      if (confirm !== true) {
        requireFullySigned([signedTransaction]);
        const { tip, warning } = await checkApexTip([signedTransaction], region);
        return needsConfirmation(
          `Would send this signed transaction through Apex (${getApexUrl(region)}) with a ${tip.lamports}-lamport tip, paid only if it lands.`,
          { transaction: describeTransaction(signedTransaction), tip, ...(warning ? { warning } : {}) },
        );
      }
      return asJson(
        await sendViaApex(signedTransaction, { region, mevProtect, maxRetries }),
        'Transaction accepted by Apex. Use getTransaction to confirm landing.',
      );
    },
  );

  defineTool(
    server,
    'apexSendBundle',
    {
      title: 'Send Bundle via Apex',
      description:
        'Submits 1-4 signed transactions as an atomic, ordered bundle through OrbitFlare Apex. Bundles only land on Jito-enabled leaders; for a single transaction prefer sendTransaction with via "apex". Exactly one transaction must carry the Apex tip (one top-level SystemProgram transfer to an Apex tip account, >= 0.001 SOL on the standard tier). Without confirm: true it only checks the bundle. Returns a bundle id; track it with apexGetBundleStatuses on the same region.',
      input: {
        transactions: z.array(z.string()).min(1).max(4).describe('1-4 base-64 encoded signed transactions, in execution order'),
        region: apexRegionSchema,
        confirm: confirmSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ transactions, region, confirm }) => {
      const client = confirm === true ? apexClient(region) : null;
      requireFullySigned(transactions);
      const { tip, warning } = await checkApexTip(transactions, region);
      if (!client) {
        return needsConfirmation(
          `Would send a ${transactions.length}-transaction bundle through Apex (${getApexUrl(region)}); all land in order or none do, tip ${tip.lamports} lamports.`,
          { transactions: transactions.map(describeTransaction), tip, ...(warning ? { warning } : {}) },
        );
      }
      const encoder = getBase64Encoder();
      const { bundleId, signatures } = await client.sendBundle(transactions.map((tx) => encoder.encode(tx) as Uint8Array));
      return asJson(
        {
          bundleId,
          signatures,
          endpoint: getApexUrl(region),
          tip: { transactionIndex: tip.transactionIndex, account: tip.account, lamports: tip.lamports },
          ...(warning ? { warning } : {}),
        },
        'Bundle accepted by Apex. Poll apexGetBundleStatuses with this bundleId on the same region.',
      );
    },
  );

  defineTool(
    server,
    'apexGetBundleStatuses',
    {
      title: 'Get Apex Bundle Statuses',
      description:
        'Returns Pending / Landed / Failed / Invalid plus the landed slot for Apex bundles. Query the same region and API key that sent the bundle; ids older than five minutes read as Invalid.',
      input: {
        bundleIds: z.array(z.string()).min(1).max(100).describe('Bundle ids returned by apexSendBundle (up to 100)'),
        region: apexRegionSchema,
      },
      annotations: READ,
    },
    async ({ bundleIds, region }) => asJson({ statuses: await apexClient(region).getBundleStatuses(bundleIds) }),
  );

  defineTool(
    server,
    'apexGetTipAccounts',
    {
      title: 'Get Apex Tip Accounts',
      description: `Lists the tip accounts an Apex endpoint accepts, with one picked at random to use. No API key needed. ${TIP_RULE}`,
      input: { region: apexRegionSchema },
      annotations: READ,
    },
    async ({ region }) => {
      const tipAccounts = await getApexTipAccounts(region);
      return asJson({
        endpoint: getApexUrl(region),
        tipAccounts,
        suggested: pickApexTipAccount(tipAccounts),
        minTipLamports: APEX_MIN_TIP_LAMPORTS,
      });
    },
  );

  defineTool(
    server,
    'apexPing',
    {
      title: 'Ping Apex Endpoints',
      description:
        'Measures round-trip latency to OrbitFlare Apex endpoints (no API key needed) to pick the nearest region for sending. Latency is measured from the machine running this MCP server.',
      input: {
        region: apexRegionSchema.describe(
          'Apex region to ping. Omit to ping every region (or the ORBITFLARE_APEX_URL endpoint, if set) and rank by latency.',
        ),
      },
      annotations: READ,
    },
    async ({ region }) => {
      const targets: (ApexRegion | undefined)[] =
        region || hasApexUrlOverride() ? [region] : APEX_REGIONS.filter((r) => r !== 'global');
      const results = await Promise.all(targets.map(ping));
      results.sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity));
      return asJson({ results, fastest: results.find((r) => r.ok)?.region ?? null });
    },
  );
}
