import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  inputMint: z.string().describe('Input token mint address'),
  outputMint: z.string().describe('Output token mint address'),
  amount: z
    .union([z.number().int().positive(), z.string()])
    .describe(
      'Raw integer amount of input tokens before decimals (lamports for SOL, atomic units otherwise)',
    ),
  slippageBps: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .optional()
    .describe('Slippage tolerance in basis points (50 = 0.5%, default 50)'),
  restrictIntermediateTokens: z
    .boolean()
    .optional()
    .describe('Restrict routing to highly-liquid intermediates (default true)'),
  onlyDirectRoutes: z
    .boolean()
    .optional()
    .describe('Restrict to single-market routes only'),
  jupiterApiKey: z
    .string()
    .optional()
    .describe(
      'Optional Jupiter API key (x-api-key) — required for the public api.jup.ag endpoint. Not needed when using the OrbitFlare Dedicated Node /jup path.',
    ),
};

const COMMON_MINTS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

function resolveMint(input: string): string {
  return COMMON_MINTS[input.toUpperCase()] ?? input;
}

export function registerGetSwapQuote(server: McpServer): void {
  server.registerTool(
    'getSwapQuote',
    {
      title: 'Get Swap Quote (Metis / Jupiter)',
      description:
        "Returns a Jupiter Metis routing quote for swapping one SPL token for another. Symbols 'SOL', 'USDC', 'USDT' are auto-resolved to their mints. Use this quote with /swap/v1/swap to build the transaction.",
      inputSchema,
    },
    async ({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      restrictIntermediateTokens,
      onlyDirectRoutes,
      jupiterApiKey,
    }) => {
      try {
        const params = new URLSearchParams({
          inputMint: resolveMint(inputMint),
          outputMint: resolveMint(outputMint),
          amount: String(amount),
          slippageBps: String(slippageBps ?? 50),
          restrictIntermediateTokens: String(restrictIntermediateTokens ?? true),
        });
        if (onlyDirectRoutes) params.set('onlyDirectRoutes', 'true');

        const url = `https://api.jup.ag/swap/v1/quote?${params.toString()}`;
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (jupiterApiKey) headers['x-api-key'] = jupiterApiKey;

        const res = await fetch(url, { headers });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Jupiter quote HTTP ${res.status}: ${text}`);
        }
        const quote = await res.json();
        return asJson(
          {
            quote,
            nextStep:
              'POST this quote object to https://api.jup.ag/swap/v1/swap with userPublicKey to receive a signed-ready transaction. See https://docs.orbitflare.com/trading-apis/metis-swap',
          },
          'Quote fetched. Slippage controls otherAmountThreshold (the minimum you accept), not outAmount.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
