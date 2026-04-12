import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
};

interface EpochInfo {
  absoluteSlot: number;
  blockHeight: number;
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
  transactionCount?: number;
}

export function registerGetEpochInfo(server: McpServer): void {
  server.registerTool(
    'getEpochInfo',
    {
      title: 'Get Epoch Info',
      description:
        'Returns the current epoch number, slot index within the epoch, total slots in the epoch, and absolute slot height.',
      inputSchema,
    },
    async ({ commitment }) => {
      try {
        const info = await rpcCall<EpochInfo>('getEpochInfo', [
          { commitment: commitment ?? 'confirmed' },
        ]);
        return asJson({
          ...info,
          progressPct: +((info.slotIndex / info.slotsInEpoch) * 100).toFixed(2),
          remainingSlots: info.slotsInEpoch - info.slotIndex,
        });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
