import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  signature: z.string().describe('Transaction signature (base-58)'),
  commitment: z
    .enum(['confirmed', 'finalized'])
    .optional()
    .describe('Commitment level (default: confirmed)'),
  maxSupportedTransactionVersion: z
    .number()
    .int()
    .min(0)
    .max(0)
    .optional()
    .describe('Set to 0 to support versioned transactions'),
};

export function registerGetTransaction(server: McpServer): void {
  server.registerTool(
    'getTransaction',
    {
      title: 'Get Transaction',
      description:
        'Returns parsed transaction details for a confirmed signature: instructions, accounts, log messages, fee, status, and slot.',
      inputSchema,
    },
    async ({ signature, commitment, maxSupportedTransactionVersion }) => {
      try {
        const result = await rpcCall('getTransaction', [
          signature,
          {
            encoding: 'jsonParsed',
            commitment: commitment ?? 'confirmed',
            maxSupportedTransactionVersion: maxSupportedTransactionVersion ?? 0,
          },
        ]);
        if (result === null) {
          return asJson(
            { signature, found: false },
            'Transaction not found at this commitment. Try `finalized` or wait a few seconds.',
          );
        }
        return asJson(result);
      } catch (err) {
        return asError(err);
      }
    },
  );
}
