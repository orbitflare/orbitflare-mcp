import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson, lamportsToSol } from '../../utils/formatters.js';

const inputSchema = {
  dataLength: z
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .describe('Account data size in bytes'),
};

export function registerGetMinimumBalanceForRentExemption(server: McpServer): void {
  server.registerTool(
    'getMinimumBalanceForRentExemption',
    {
      title: 'Get Minimum Rent Exemption Balance',
      description:
        'Returns the minimum lamports an account must hold to be rent-exempt for a given data size.',
      inputSchema,
    },
    async ({ dataLength }) => {
      try {
        const lamports = await rpcCall<number>(
          'getMinimumBalanceForRentExemption',
          [dataLength],
        );
        return asJson({
          dataLength,
          lamports,
          sol: lamportsToSol(lamports),
        });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
