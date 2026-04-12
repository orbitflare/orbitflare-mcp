import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';
import { setBearerToken } from '../../config.js';

const inputSchema = {
  wallet_address: z.string().describe('Solana wallet public key (base58)'),
  challenge: z.string().describe('Challenge string from requestWalletChallenge'),
  signature: z.string().describe('Base-58 Ed25519 signature of the challenge'),
  name: z.string().optional().describe('Display name (optional)'),
  email: z.string().email().optional().describe('Email address (optional)'),
};

interface AuthResponse {
  success: boolean;
  data?: { token: string; user?: { id: number; name?: string } };
}

export function registerRegisterWithWallet(server: McpServer): void {
  server.registerTool(
    'registerWithWallet',
    {
      title: 'Register New Account With Wallet',
      description:
        'Creates a new OrbitFlare account linked to a Solana wallet. Stores the returned Bearer token in the session on success.',
      inputSchema,
    },
    async ({ wallet_address, challenge, signature, name, email }) => {
      try {
        const result = await customerApi<AuthResponse>('/auth/wallet/register', {
          method: 'POST',
          public: true,
          body: { wallet_address, challenge, signature, name, email },
        });
        if (result.data?.token) {
          setBearerToken(result.data.token);
          return asJson(
            { token: 'stored', user: result.data.user ?? null },
            'Account registered. Bearer token stored.',
          );
        }
        return asJson(result);
      } catch (err) {
        return asError(err);
      }
    },
  );
}
