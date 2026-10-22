import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { asJson } from '../utils/formatters.js';
import { defineTool, READ } from './define.js';

const COMMON_MINTS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

function resolveMint(input: string): string {
  return COMMON_MINTS[input.toUpperCase()] ?? input;
}

export function registerSwapTools(server: McpServer): void {
  defineTool(
    server,
    'getSwapQuote',
    {
      title: 'Get Swap Quote',
      description:
        "Returns a Jupiter Metis routing quote for swapping one SPL token for another. 'SOL', 'USDC' and 'USDT' resolve to their mints. Quote only: nothing is signed or sent.",
      input: {
        inputMint: z.string().describe('Input token mint address (or SOL / USDC / USDT)'),
        outputMint: z.string().describe('Output token mint address (or SOL / USDC / USDT)'),
        amount: z
          .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
          .describe('Raw integer amount of the input token (lamports for SOL, base units otherwise)'),
        slippageBps: z.number().int().min(0).max(10000).optional().describe('Slippage in basis points (50 = 0.5%, default 50)'),
        restrictIntermediateTokens: z.boolean().optional().describe('Route only via liquid intermediates (default true)'),
        onlyDirectRoutes: z.boolean().optional().describe('Single-market routes only'),
        jupiterApiKey: z
          .string()
          .optional()
          .describe('Jupiter API key (x-api-key) for api.jup.ag; or set JUPITER_API_KEY'),
        quoteUrl: z
          .string()
          .url()
          .optional()
          .describe('Quote endpoint override, e.g. your OrbitFlare dedicated node /jup path. Defaults to JUPITER_QUOTE_URL or api.jup.ag.'),
      },
      annotations: READ,
    },
    async (args) => {
      const params = new URLSearchParams({
        inputMint: resolveMint(args.inputMint),
        outputMint: resolveMint(args.outputMint),
        amount: String(args.amount),
        slippageBps: String(args.slippageBps ?? 50),
        restrictIntermediateTokens: String(args.restrictIntermediateTokens ?? true),
      });
      if (args.onlyDirectRoutes) params.set('onlyDirectRoutes', 'true');
      const base = args.quoteUrl ?? process.env.JUPITER_QUOTE_URL ?? 'https://api.jup.ag/swap/v1/quote';
      const headers: Record<string, string> = { Accept: 'application/json' };
      const key = args.jupiterApiKey ?? process.env.JUPITER_API_KEY;
      if (key) headers['x-api-key'] = key;
      const res = await fetch(`${base}?${params.toString()}`, { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Jupiter quote HTTP ${res.status}: ${text}`);
      }
      const quote = await res.json();
      return asJson(
        {
          quote,
          nextStep:
            'POST this quote to the Jupiter /swap/v1/swap endpoint with userPublicKey to get a transaction, then use simulateTransaction and sendTransaction. See https://docs.orbitflare.com/trading-apis/metis-swap',
        },
        'Quote fetched. Slippage sets otherAmountThreshold (the minimum you accept), not outAmount.',
      );
    },
  );
}
