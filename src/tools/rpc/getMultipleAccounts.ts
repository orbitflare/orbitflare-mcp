import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  addresses: z
    .array(z.string())
    .min(1)
    .max(100)
    .describe('Up to 100 account addresses to fetch in one call'),
  encoding: z
    .enum(['base58', 'base64', 'base64+zstd', 'jsonParsed'])
    .optional()
    .describe('Account data encoding (default: jsonParsed)'),
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
};

export function registerGetMultipleAccounts(server: McpServer): void {
  server.registerTool(
    'getMultipleAccounts',
    {
      title: 'Get Multiple Accounts',
      description:
        'Batch-fetch up to 100 accounts in a single request. Each entry includes lamports, owner, executable, and parsed data when available. Returns null for missing accounts.',
      inputSchema,
    },
    async ({ addresses, encoding, commitment }) => {
      try {
        const result = await rpcCall('getMultipleAccounts', [
          addresses,
          {
            encoding: encoding ?? 'jsonParsed',
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
