import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  message: z
    .string()
    .describe('Base-64 encoded compiled transaction message (NOT a full transaction).'),
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
};

export function registerGetFeeForMessage(server: McpServer): void {
  server.registerTool(
    'getFeeForMessage',
    {
      title: 'Get Fee For Message',
      description:
        'Returns the fee in lamports the network will charge for the given compiled transaction message.',
      inputSchema,
    },
    async ({ message, commitment }) => {
      try {
        const result = await rpcCall<{
          context: { slot: number };
          value: number | null;
        }>('getFeeForMessage', [message, { commitment: commitment ?? 'confirmed' }]);
        return asJson({
          slot: result.context.slot,
          feeLamports: result.value,
        });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
