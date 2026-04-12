import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  loadKeypairFromBase58Secret,
  loadKeypairFromFile,
} from '../../utils/keypair.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  source: z
    .union([
      z.object({ base58Secret: z.string() }),
      z.object({ filePath: z.string() }),
    ])
    .describe(
      'Either a base58-encoded secret key OR a path to a Solana CLI keypair file (JSON array of 64 bytes)',
    ),
};

export function registerLoadKeypair(server: McpServer): void {
  server.registerTool(
    'loadKeypair',
    {
      title: 'Load Wallet Keypair',
      description:
        'Loads a Solana keypair into the session from a base58 secret OR a file path. Replaces any currently loaded keypair. SECURITY: secrets are kept in process memory; do not pass production wallets in chat.',
      inputSchema,
    },
    async ({ source }) => {
      try {
        const signer =
          'base58Secret' in source
            ? await loadKeypairFromBase58Secret(source.base58Secret)
            : await loadKeypairFromFile(source.filePath);
        return asJson(
          { address: signer.address },
          'Keypair loaded into session. It will not be persisted unless you also call generateKeypair (which persists by default).',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
