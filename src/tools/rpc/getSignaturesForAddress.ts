import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  address: z.string().describe('Account address to look up signatures for'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe('Maximum signatures to return (1-1000, default 25)'),
  before: z
    .string()
    .optional()
    .describe('Start searching backward from this signature (pagination)'),
  until: z
    .string()
    .optional()
    .describe('Search until this signature is reached (pagination)'),
  commitment: z.enum(['confirmed', 'finalized']).optional(),
};

interface SigEntry {
  signature: string;
  slot: number;
  err: unknown;
  memo: string | null;
  blockTime: number | null;
  confirmationStatus?: string;
}

export function registerGetSignaturesForAddress(server: McpServer): void {
  server.registerTool(
    'getSignaturesForAddress',
    {
      title: 'Get Signatures For Address',
      description:
        'Returns recent transaction signatures involving a Solana address, with status, slot, blockTime, and any memo. Useful for wallet history.',
      inputSchema,
    },
    async ({ address, limit, before, until, commitment }) => {
      try {
        const result = await rpcCall<SigEntry[]>('getSignaturesForAddress', [
          address,
          {
            limit: limit ?? 25,
            before,
            until,
            commitment: commitment ?? 'confirmed',
          },
        ]);
        return asJson(
          {
            address,
            count: result.length,
            signatures: result,
          },
          result.length === 0
            ? 'No signatures found for this address.'
            : `Returned ${result.length} signatures.`,
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
