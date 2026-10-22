import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import bs58 from 'bs58';
import { existsSync } from 'node:fs';
import { paths } from '../config.js';
import { asJson, needsConfirmation } from '../utils/formatters.js';
import {
  clearKeypair,
  generateKeypair,
  getActiveSigner,
  loadKeypairFromBase58Secret,
  loadKeypairFromFile,
  requireSigner,
  signatureToBase58,
  signMessageBytes,
} from '../utils/keypair.js';
import { confirmSchema, defineTool, DESTRUCTIVE_LOCAL } from './define.js';

function decode(message: string, encoding: 'utf8' | 'base64' | 'base58'): Uint8Array {
  if (encoding === 'base64') return new Uint8Array(Buffer.from(message, 'base64'));
  if (encoding === 'base58') return bs58.decode(message);
  return new TextEncoder().encode(message);
}

export function registerWalletTools(server: McpServer): void {
  defineTool(
    server,
    'wallet',
    {
      title: 'Session Wallet',
      description:
        'Manages the local signing keypair used by sendTransaction, the build* tools and wallet sign-in. Actions: "status" (loaded address), "generate" (new keypair, persisted to ~/.orbitflare/mcp-keypair.json unless persist=false), "load" (from a base58 secret or a Solana CLI keypair file), "signMessage" (Ed25519-sign a message), "clear" (unload; removeFromDisk also deletes the persisted file and needs confirm). The persisted file is plaintext: never keep meaningful funds in it.',
      input: {
        action: z.enum(['status', 'generate', 'load', 'signMessage', 'clear']),
        persist: z.boolean().optional().describe('generate: save to ~/.orbitflare/mcp-keypair.json (mode 0600). Default true.'),
        base58Secret: z.string().optional().describe('load: base58 secret key (32 or 64 bytes)'),
        filePath: z.string().optional().describe('load: path to a Solana CLI keypair JSON file'),
        message: z.string().optional().describe('signMessage: the message'),
        encoding: z.enum(['utf8', 'base64', 'base58']).optional().describe('signMessage: message encoding (default utf8)'),
        removeFromDisk: z.boolean().optional().describe('clear: also delete the persisted keypair file'),
        confirm: confirmSchema,
      },
      annotations: DESTRUCTIVE_LOCAL,
    },
    async (args) => {
      const { KEYPAIR_FILE } = paths();
      switch (args.action) {
        case 'status': {
          const signer = getActiveSigner();
          return asJson({ loaded: signer !== null, address: signer?.address ?? null, persistedFile: existsSync(KEYPAIR_FILE) ? KEYPAIR_FILE : null });
        }
        case 'generate': {
          const persist = args.persist !== false;
          const signer = await generateKeypair(persist);
          return asJson(
            { address: signer.address, persisted: persist, persistedTo: persist ? KEYPAIR_FILE : null },
            'Keypair created and loaded. Fund it before building transactions.',
          );
        }
        case 'load': {
          if (!args.base58Secret && !args.filePath) throw new Error('load needs base58Secret or filePath.');
          const signer = args.base58Secret
            ? await loadKeypairFromBase58Secret(args.base58Secret)
            : await loadKeypairFromFile(args.filePath!);
          return asJson({ address: signer.address }, 'Keypair loaded into this session (not persisted).');
        }
        case 'signMessage': {
          if (args.message === undefined) throw new Error('signMessage needs message.');
          const signer = requireSigner();
          const sig = await signMessageBytes(decode(args.message, args.encoding ?? 'utf8'));
          return asJson({
            publicKey: signer.address,
            signatureBase58: signatureToBase58(sig),
            signatureBase64: Buffer.from(sig).toString('base64'),
          });
        }
        case 'clear': {
          if (args.removeFromDisk && args.confirm !== true) {
            return needsConfirmation(
              `Would unload the wallet and permanently delete ${KEYPAIR_FILE}. Any funds in it are lost unless the secret is backed up elsewhere.`,
              { address: getActiveSigner()?.address ?? null, file: KEYPAIR_FILE, fileExists: existsSync(KEYPAIR_FILE) },
            );
          }
          clearKeypair(args.removeFromDisk === true);
          return asJson({
            loaded: false,
            removedFromDisk: args.removeFromDisk === true,
          });
        }
      }
    },
  );
}
