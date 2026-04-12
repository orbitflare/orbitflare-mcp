import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  slot: z.number().int().nonnegative().describe('Slot number'),
  transactionDetails: z
    .enum(['full', 'accounts', 'signatures', 'none'])
    .optional()
    .describe('Detail level for transactions in the block (default: signatures)'),
  rewards: z.boolean().optional().describe('Whether to include block rewards'),
  commitment: z.enum(['confirmed', 'finalized']).optional(),
};

export function registerGetBlock(server: McpServer): void {
  server.registerTool(
    'getBlock',
    {
      title: 'Get Block',
      description:
        'Returns metadata and transaction info for a confirmed block. Default `transactionDetails: signatures` keeps the response small — switch to `full` only when you need the full payload.',
      inputSchema,
    },
    async ({ slot, transactionDetails, rewards, commitment }) => {
      try {
        const result = await rpcCall('getBlock', [
          slot,
          {
            encoding: 'jsonParsed',
            transactionDetails: transactionDetails ?? 'signatures',
            rewards: rewards ?? false,
            maxSupportedTransactionVersion: 0,
            commitment: commitment ?? 'confirmed',
          },
        ]);
        return asJson(result);
      } catch (err) {
        return asError(err);
      }
    },
  );
}
