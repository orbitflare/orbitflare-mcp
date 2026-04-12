import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
};

export function registerGetSlot(server: McpServer): void {
  server.registerTool(
    'getSlot',
    {
      title: 'Get Current Slot',
      description: 'Returns the current slot of the OrbitFlare RPC node.',
      inputSchema,
    },
    async ({ commitment }) => {
      try {
        const slot = await rpcCall<number>('getSlot', [
          { commitment: commitment ?? 'confirmed' },
        ]);
        return asJson({ slot, commitment: commitment ?? 'confirmed' });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
