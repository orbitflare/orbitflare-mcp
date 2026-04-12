import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asText } from '../../utils/formatters.js';
import { clearBearerToken, getBearerToken } from '../../config.js';

export function registerRevokeToken(server: McpServer): void {
  server.registerTool(
    'revokeToken',
    {
      title: 'Revoke Bearer Token / Logout',
      description:
        'Revokes the current Bearer token via the OrbitFlare logout endpoint and clears it from the session. API key sessions cannot be revoked here.',
      inputSchema: {},
    },
    async () => {
      try {
        if (!getBearerToken()) {
          return asText('No Bearer token in session — nothing to revoke.');
        }
        await customerApi('/auth/logout', { method: 'POST' }).catch(() => null);
        clearBearerToken();
        return asText('Bearer token revoked and cleared from session.');
      } catch (err) {
        return asError(err);
      }
    },
  );
}
