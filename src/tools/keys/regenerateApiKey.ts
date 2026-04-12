import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  id: z.union([z.number().int().positive(), z.string()]).describe('API key ID'),
};

export function registerRegenerateApiKey(server: McpServer): void {
  server.registerTool(
    'regenerateApiKey',
    {
      title: 'Regenerate API Key',
      description:
        'Regenerates an existing API key. Returns the new full key once — store it immediately. The old key is immediately invalidated.',
      inputSchema,
    },
    async ({ id }) => {
      try {
        return asJson(
          await customerApi(`/api-keys/${id}/regenerate`, { method: 'POST' }),
          'IMPORTANT: copy the new `key` now — it cannot be retrieved later. The old key is now invalid.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
