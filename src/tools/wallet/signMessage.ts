import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import bs58 from 'bs58';
import {
  getActiveSigner,
  signMessageBytes,
  signatureToBase58,
} from '../../utils/keypair.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  message: z.string().describe('Message string to sign with Ed25519'),
  encoding: z
    .enum(['utf8', 'base64', 'base58'])
    .optional()
    .describe('Encoding of the message string (default utf8)'),
};

function decode(message: string, encoding: 'utf8' | 'base64' | 'base58'): Uint8Array {
  if (encoding === 'base64') return new Uint8Array(Buffer.from(message, 'base64'));
  if (encoding === 'base58') return bs58.decode(message);
  return new TextEncoder().encode(message);
}

export function registerSignMessage(server: McpServer): void {
  server.registerTool(
    'signMessage',
    {
      title: 'Sign Arbitrary Message',
      description:
        'Ed25519-signs an arbitrary message with the loaded session keypair. Returns the base58 signature plus the signing public key — pass these to verifyWalletSignature or registerWithWallet for OrbitFlare wallet auth.',
      inputSchema,
    },
    async ({ message, encoding }) => {
      try {
        const signer = getActiveSigner();
        if (!signer) {
          return asError(
            new Error('No keypair loaded. Use generateKeypair or loadKeypair first.'),
          );
        }
        const bytes = decode(message, encoding ?? 'utf8');
        const sig = await signMessageBytes(bytes);
        return asJson({
          publicKey: signer.address,
          signatureBase58: signatureToBase58(sig),
          signatureBase64: Buffer.from(sig).toString('base64'),
        });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
