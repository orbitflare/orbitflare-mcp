import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  tokenAccount: z.string().describe('SPL token account address (NOT the wallet address)'),
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
};

interface TokenBalance {
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString: string;
}

export function registerGetTokenAccountBalance(server: McpServer): void {
  server.registerTool(
    'getTokenAccountBalance',
    {
      title: 'Get Token Account Balance',
      description:
        'Returns the balance of a specific SPL token account. Note: this expects the token account address, not the wallet address — use getTokenAccountsByOwner first to find token accounts.',
      inputSchema,
    },
    async ({ tokenAccount, commitment }) => {
      try {
        const result = await rpcCall<{
          context: { slot: number };
          value: TokenBalance;
        }>('getTokenAccountBalance', [
          tokenAccount,
          { commitment: commitment ?? 'confirmed' },
        ]);
        return asJson({
          tokenAccount,
          slot: result.context.slot,
          ...result.value,
        });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
