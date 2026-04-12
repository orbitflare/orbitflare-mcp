import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  transaction: z.string().describe('Base-64 encoded transaction (signed or unsigned)'),
  sigVerify: z
    .boolean()
    .optional()
    .describe('Verify transaction signatures during simulation (default false)'),
  replaceRecentBlockhash: z
    .boolean()
    .optional()
    .describe(
      "Replace transaction's recent blockhash with the most recent one (useful for unsigned tx simulation)",
    ),
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
  innerInstructions: z
    .boolean()
    .optional()
    .describe('Include inner instructions in the response'),
};

export function registerSimulateTransaction(server: McpServer): void {
  server.registerTool(
    'simulateTransaction',
    {
      title: 'Simulate Transaction',
      description:
        'Simulates a transaction against the current bank state without broadcasting it. Returns logs, consumed compute units, and any error.',
      inputSchema,
    },
    async ({
      transaction,
      sigVerify,
      replaceRecentBlockhash,
      commitment,
      innerInstructions,
    }) => {
      try {
        const config: Record<string, unknown> = {
          encoding: 'base64',
          commitment: commitment ?? 'confirmed',
          sigVerify: sigVerify ?? false,
          replaceRecentBlockhash: replaceRecentBlockhash ?? false,
        };
        if (innerInstructions !== undefined) {
          config.innerInstructions = innerInstructions;
        }
        const result = await rpcCall('simulateTransaction', [transaction, config]);
        return asJson(result);
      } catch (err) {
        return asError(err);
      }
    },
  );
}
