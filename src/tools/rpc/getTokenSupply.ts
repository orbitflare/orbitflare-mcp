import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  mint: z.string().describe('SPL token mint address'),
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
};

interface TokenSupply {
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString: string;
}

export function registerGetTokenSupply(server: McpServer): void {
  server.registerTool(
    'getTokenSupply',
    {
      title: 'Get Token Supply',
      description:
        'Returns the total supply of an SPL token mint, with decimals and UI-formatted amount.',
      inputSchema,
    },
    async ({ mint, commitment }) => {
      try {
        const result = await rpcCall<{
          context: { slot: number };
          value: TokenSupply;
        }>('getTokenSupply', [mint, { commitment: commitment ?? 'confirmed' }]);
        return asJson({ mint, slot: result.context.slot, ...result.value });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
