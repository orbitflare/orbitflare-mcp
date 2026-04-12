import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { generateKeypair } from '../../utils/keypair.js';
import { asError, asJson } from '../../utils/formatters.js';
import { paths } from '../../config.js';

const inputSchema = {
  persist: z
    .boolean()
    .optional()
    .describe(
      'Persist to ~/.orbitflare/mcp-keypair.json (file mode 0600) so the wallet survives restarts. Default true.',
    ),
};

export function registerGenerateKeypair(server: McpServer): void {
  server.registerTool(
    'generateKeypair',
    {
      title: 'Generate Wallet Keypair',
      description:
        'Generates a new Solana Ed25519 keypair, stores it in the session, and (by default) persists the seed to ~/.orbitflare/mcp-keypair.json. WARNING: the on-disk file is plaintext — anyone with filesystem access can spend funds in this wallet. For production use, prefer loadKeypair with a hardware/encrypted source.',
      inputSchema,
    },
    async ({ persist }) => {
      try {
        const signer = await generateKeypair(persist !== false);
        return asJson(
          {
            address: signer.address,
            persisted: persist !== false,
            persistedTo: persist !== false ? paths().KEYPAIR_FILE : null,
          },
          'Keypair created. Use getWalletAddress to retrieve the address again, or buildSolTransfer / signAndSendTransaction to spend.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
