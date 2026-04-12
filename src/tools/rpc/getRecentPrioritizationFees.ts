import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  addresses: z
    .array(z.string())
    .max(128)
    .optional()
    .describe(
      'Optional list of writable account addresses. Returns fees for the local fee market touching those accounts.',
    ),
};

interface FeeSample {
  slot: number;
  prioritizationFee: number;
}

export function registerGetRecentPrioritizationFees(server: McpServer): void {
  server.registerTool(
    'getRecentPrioritizationFees',
    {
      title: 'Get Recent Prioritization Fees',
      description:
        'Returns recent priority fee samples (micro-lamports per CU) plus suggested percentiles (P50/P75/P90/P99) so you can pick a competitive priority fee for your transaction.',
      inputSchema,
    },
    async ({ addresses }) => {
      try {
        const samples = await rpcCall<FeeSample[]>(
          'getRecentPrioritizationFees',
          addresses && addresses.length > 0 ? [addresses] : [],
        );

        const fees = samples
          .map((s) => s.prioritizationFee)
          .sort((a, b) => a - b);

        const percentile = (p: number): number => {
          if (fees.length === 0) return 0;
          const idx = Math.min(
            fees.length - 1,
            Math.floor((p / 100) * fees.length),
          );
          return fees[idx];
        };

        return asJson({
          sampleCount: samples.length,
          microLamportsPerCu: {
            min: fees[0] ?? 0,
            p50: percentile(50),
            p75: percentile(75),
            p90: percentile(90),
            p99: percentile(99),
            max: fees[fees.length - 1] ?? 0,
          },
          recentSamples: samples.slice(0, 10),
        });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
