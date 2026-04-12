import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

export function registerListApiKeys(server: McpServer): void {
  server.registerTool(
    'listApiKeys',
    {
      title: 'List API Keys',
      description: 'Lists all API keys on the authenticated OrbitFlare account (masked).',
      inputSchema: {},
    },
    async () => {
      try {
        return asJson(await customerApi('/api-keys'));
      } catch (err) {
        return asError(err);
      }
    },
  );
}
