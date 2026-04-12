import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

export function registerListRpcPlans(server: McpServer): void {
  server.registerTool(
    'listRpcPlans',
    {
      title: 'List Available RPC Plans',
      description:
        'Lists OrbitFlare RPC plans (Free, Developer, Growth, Scale, Pro) with pricing, RPS/TPS limits, and included features. Useful for comparing tiers before purchasing.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await customerApi('/rpc-plans');
        return asJson(result);
      } catch (err) {
        return asError(err);
      }
    },
  );
}
