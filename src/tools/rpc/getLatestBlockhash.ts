import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
};

export function registerGetLatestBlockhash(server: McpServer): void {
  server.registerTool(
    'getLatestBlockhash',
    {
      title: 'Get Latest Blockhash',
      description:
        'Returns the most recent blockhash and the last valid block height. Use these when constructing a new transaction.',
      inputSchema,
    },
    async ({ commitment }) => {
      try {
        const result = await rpcCall<{
          context: { slot: number };
          value: { blockhash: string; lastValidBlockHeight: number };
        }>('getLatestBlockhash', [{ commitment: commitment ?? 'confirmed' }]);
        return asJson({
          slot: result.context.slot,
          blockhash: result.value.blockhash,
          lastValidBlockHeight: result.value.lastValidBlockHeight,
        });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
