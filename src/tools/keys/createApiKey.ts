import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  name: z.string().min(1).max(100).describe('Friendly name for the new API key'),
};

export function registerCreateApiKey(server: McpServer): void {
  server.registerTool(
    'createApiKey',
    {
      title: 'Create API Key',
      description:
        'Creates a new OrbitFlare API key. SECURITY: the full key is returned exactly once — store it immediately. Subsequent listings show only the masked value.',
      inputSchema,
    },
    async ({ name }) => {
      try {
        return asJson(
          await customerApi('/api-keys', { method: 'POST', body: { name } }),
          'IMPORTANT: copy the `key` value now — it cannot be retrieved later.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
