import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getActiveSigner } from '../../utils/keypair.js';
import { asJson } from '../../utils/formatters.js';

export function registerGetWalletAddress(server: McpServer): void {
  server.registerTool(
    'getWalletAddress',
    {
      title: 'Get Loaded Wallet Address',
      description:
        'Returns the public address of the currently loaded session keypair, or null if no keypair is loaded.',
      inputSchema: {},
    },
    async () => {
      const signer = getActiveSigner();
      return asJson({
        loaded: signer !== null,
        address: signer?.address ?? null,
      });
    },
  );
}
