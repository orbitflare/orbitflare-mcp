import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  wallet_address: z
    .string()
    .min(32)
    .max(44)
    .describe('Solana wallet public key (base58)'),
};

interface ChallengeResponse {
  success: boolean;
  data?: { challenge: string; expires_in: number };
}

export function registerRequestWalletChallenge(server: McpServer): void {
  server.registerTool(
    'requestWalletChallenge',
    {
      title: 'Request Wallet Auth Challenge',
      description:
        'Returns a one-time challenge string for a wallet address. Sign it with the wallet keypair via signMessage, then call verifyWalletSignature (existing account) or registerWithWallet (new account).',
      inputSchema,
    },
    async ({ wallet_address }) => {
      try {
        const result = await customerApi<ChallengeResponse>(
          '/auth/wallet/challenge',
          {
            method: 'POST',
            public: true,
            body: { wallet_address },
          },
        );
        return asJson(
          { wallet_address, ...result.data },
          'Sign the `challenge` string with your Solana keypair (Ed25519), then call verifyWalletSignature or registerWithWallet.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
