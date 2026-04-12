import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

export function registerListLicenses(server: McpServer): void {
  server.registerTool(
    'listLicenses',
    {
      title: 'List OrbitFlare Licenses',
      description:
        'Lists all RPC licenses (subscriptions) on the authenticated OrbitFlare account, with plan, status, region access, and license keys (masked).',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await customerApi('/licenses');
        return asJson(result);
      } catch (err) {
        return asError(err);
      }
    },
  );
}
