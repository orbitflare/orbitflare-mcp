import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';
import { setBearerToken } from '../../config.js';

const inputSchema = {
  wallet_address: z.string().describe('Solana wallet public key (base58)'),
  challenge: z.string().describe('Challenge string returned by requestWalletChallenge'),
  signature: z.string().describe('Base-58 encoded Ed25519 signature of the challenge'),
};

interface AuthResponse {
  success: boolean;
  data?: { token: string; user?: { id: number; name?: string } };
}

export function registerVerifyWalletSignature(server: McpServer): void {
  server.registerTool(
    'verifyWalletSignature',
    {
      title: 'Verify Wallet Signature (sign in)',
      description:
        'Verifies a signed wallet challenge for an existing OrbitFlare account. On success, stores the returned Bearer token in the session.',
      inputSchema,
    },
    async ({ wallet_address, challenge, signature }) => {
      try {
        const result = await customerApi<AuthResponse>('/auth/wallet/verify', {
          method: 'POST',
          public: true,
          body: { wallet_address, challenge, signature },
        });
        if (result.data?.token) {
          setBearerToken(result.data.token);
          return asJson(
            { token: 'stored', user: result.data.user ?? null },
            'Signed in. Bearer token stored.',
          );
        }
        return asJson(result);
      } catch (err) {
        return asError(err);
      }
    },
  );
}
