import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { clearKeypair } from '../../utils/keypair.js';
import { asText } from '../../utils/formatters.js';

const inputSchema = {
  removeFromDisk: z
    .boolean()
    .optional()
    .describe('Also delete ~/.orbitflare/mcp-keypair.json (default false)'),
};

export function registerClearKeypair(server: McpServer): void {
  server.registerTool(
    'clearKeypair',
    {
      title: 'Clear Wallet Keypair',
      description:
        'Removes the keypair from the current session. Pass removeFromDisk=true to also delete the persisted keypair file.',
      inputSchema,
    },
    async ({ removeFromDisk }) => {
      clearKeypair(removeFromDisk === true);
      return asText(
        removeFromDisk
          ? 'Keypair cleared from session and disk.'
          : 'Keypair cleared from session (persisted file kept).',
      );
    },
  );
}
