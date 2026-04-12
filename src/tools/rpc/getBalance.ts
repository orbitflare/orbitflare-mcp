import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson, lamportsToSol } from '../../utils/formatters.js';

const inputSchema = {
  address: z.string().min(32).max(48).describe('Solana account public key (base-58)'),
  commitment: z
    .enum(['processed', 'confirmed', 'finalized'])
    .optional()
    .describe('Commitment level (default: confirmed)'),
};

export function registerGetBalance(server: McpServer): void {
  server.registerTool(
    'getBalance',
    {
      title: 'Get SOL Balance',
      description:
        'Returns the SOL balance (in lamports and SOL) for a Solana account via OrbitFlare RPC.',
      inputSchema,
    },
    async ({ address, commitment }) => {
      try {
        const result = await rpcCall<{ context: { slot: number }; value: number }>(
          'getBalance',
          [address, { commitment: commitment ?? 'confirmed' }],
        );
        return asJson({
          address,
          lamports: result.value,
          sol: lamportsToSol(result.value),
          slot: result.context.slot,
        });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
