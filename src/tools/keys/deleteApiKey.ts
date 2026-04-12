import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  id: z.union([z.number().int().positive(), z.string()]).describe('API key ID to delete'),
};

export function registerDeleteApiKey(server: McpServer): void {
  server.registerTool(
    'deleteApiKey',
    {
      title: 'Delete API Key',
      description: 'Permanently deletes an API key by ID. Cannot be undone.',
      inputSchema,
    },
    async ({ id }) => {
      try {
        return asJson(await customerApi(`/api-keys/${id}`, { method: 'DELETE' }));
      } catch (err) {
        return asError(err);
      }
    },
  );
}
