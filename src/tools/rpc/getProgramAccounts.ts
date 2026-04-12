import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const memcmpSchema = z.object({
  offset: z.number().int().nonnegative(),
  bytes: z.string().describe('Base-58 encoded comparison bytes'),
});

const dataSizeSchema = z.object({ dataSize: z.number().int().positive() });

const filterSchema = z.union([
  z.object({ memcmp: memcmpSchema }),
  dataSizeSchema,
]);

const inputSchema = {
  programId: z.string().describe('Program address to query'),
  filters: z
    .array(filterSchema)
    .max(4)
    .optional()
    .describe('Account filters (memcmp / dataSize). Strongly recommended for large programs.'),
  dataSlice: z
    .object({
      offset: z.number().int().nonnegative(),
      length: z.number().int().positive(),
    })
    .optional()
    .describe('Limit returned account data to a slice'),
  encoding: z
    .enum(['base58', 'base64', 'base64+zstd', 'jsonParsed'])
    .optional(),
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Soft cap: truncate to this many accounts before returning (default 100). Use filters to narrow further.'),
};

export function registerGetProgramAccounts(server: McpServer): void {
  server.registerTool(
    'getProgramAccounts',
    {
      title: 'Get Program Accounts',
      description:
        'Returns accounts owned by a program. WARNING: very large for popular programs — always use filters (memcmp/dataSize) and a dataSlice. The result is soft-capped to `limit` (default 100); the original total is reported.',
      inputSchema,
    },
    async ({ programId, filters, dataSlice, encoding, commitment, limit }) => {
      try {
        const config: Record<string, unknown> = {
          encoding: encoding ?? 'base64',
          commitment: commitment ?? 'confirmed',
        };
        if (filters) config.filters = filters;
        if (dataSlice) config.dataSlice = dataSlice;
        const result = await rpcCall<unknown[]>('getProgramAccounts', [
          programId,
          config,
        ]);
        const cap = limit ?? 100;
        const truncated = result.length > cap ? result.slice(0, cap) : result;
        return asJson({
          programId,
          total: result.length,
          returned: truncated.length,
          truncated: result.length > truncated.length,
          accounts: truncated,
        });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
