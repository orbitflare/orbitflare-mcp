import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  amount: z
    .number()
    .min(5)
    .max(10000)
    .describe('USDC amount to top up (min $5, max $10,000)'),
  wallet_address: z
    .string()
    .min(32)
    .max(44)
    .describe("Solana wallet address that will sign the USDC transfer"),
};

interface TopUpPrepareResponse {
  success: boolean;
  data?: {
    transaction: string;
    memo: string;
    amount_usdc: number;
    amount_micro_usdc: number;
    destination_wallet: string;
    blockhash: string;
    last_valid_block_height: number;
  };
}

export function registerPrepareTopUp(server: McpServer): void {
  server.registerTool(
    'prepareTopUp',
    {
      title: 'Prepare USDC Top-Up Transaction',
      description:
        "Builds an unsigned Solana USDC transfer transaction that credits the OrbitFlare account balance. Sign the returned base64 transaction with your wallet (e.g. via signAndSendTransaction once you've loaded a keypair) then submit it via confirmTopUp.",
      inputSchema,
    },
    async ({ amount, wallet_address }) => {
      try {
        const result = await customerApi<TopUpPrepareResponse>('/topup/prepare', {
          method: 'POST',
          body: { amount, wallet_address },
        });
        return asJson(
          { ...result.data },
          'Sign the `transaction` (base64) with your wallet, then call confirmTopUp with the signed transaction string.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
