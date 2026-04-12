import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  transaction: z
    .string()
    .describe('Signed Solana transaction (base64) returned from prepareTopUp + signed locally'),
};

export function registerConfirmTopUp(server: McpServer): void {
  server.registerTool(
    'confirmTopUp',
    {
      title: 'Confirm USDC Top-Up',
      description:
        'Submits the signed top-up transaction to OrbitFlare. The server broadcasts it, waits for finality, verifies the on-chain memo / signer / amount / destination, then credits the account balance.',
      inputSchema,
    },
    async ({ transaction }) => {
      try {
        return asJson(
          await customerApi('/topup/confirm', {
            method: 'POST',
            body: { transaction },
          }),
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
