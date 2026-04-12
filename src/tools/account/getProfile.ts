import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

export function registerGetProfile(server: McpServer): void {
  server.registerTool(
    'getProfile',
    {
      title: 'Get OrbitFlare Profile',
      description:
        'Returns the authenticated user profile and current account balance from the OrbitFlare Customer API. Requires a Customer API key (set via env or setApiKey).',
      inputSchema: {},
    },
    async () => {
      try {
        const settled = await Promise.allSettled([
          customerApi('/profile'),
          customerApi('/profile/balance'),
        ]);
        const allFailed = settled.every((s) => s.status === 'rejected');
        if (allFailed) {
          const first = settled[0] as PromiseRejectedResult;
          return asError(first.reason);
        }
        const [profile, balance] = settled.map((s) =>
          s.status === 'fulfilled'
            ? s.value
            : { error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
        );
        return asJson({ profile, balance });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
