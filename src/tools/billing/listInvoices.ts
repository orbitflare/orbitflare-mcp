import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  page: z.number().int().positive().optional(),
  perPage: z.number().int().min(1).max(100).optional(),
  status: z
    .enum(['pending', 'paid', 'cancelled', 'overdue'])
    .optional()
    .describe('Filter by invoice status'),
};

export function registerListInvoices(server: McpServer): void {
  server.registerTool(
    'listInvoices',
    {
      title: 'List Invoices',
      description: 'Paginated list of OrbitFlare invoices for the authenticated user.',
      inputSchema,
    },
    async ({ page, perPage, status }) => {
      try {
        return asJson(
          await customerApi('/invoices', {
            query: { page, per_page: perPage, status },
          }),
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
