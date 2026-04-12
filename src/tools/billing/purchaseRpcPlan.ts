import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  slug: z
    .string()
    .describe('Plan slug from listRpcPlans (e.g. "developer", "growth", "scale", "pro")'),
  period: z
    .enum(['monthly', 'quarterly', 'semi-annual', 'annual'])
    .describe('Billing period'),
  coupon: z.string().optional().describe('Optional discount code'),
  validateOnly: z
    .boolean()
    .optional()
    .describe('If true, dry-run validation only (no charge, no records created)'),
};

export function registerPurchaseRpcPlan(server: McpServer): void {
  server.registerTool(
    'purchaseRpcPlan',
    {
      title: 'Purchase RPC Plan',
      description:
        'Purchases an OrbitFlare RPC plan using your account balance. Use validateOnly=true first to see pricing and confirm you can afford it without committing.',
      inputSchema,
    },
    async ({ slug, period, coupon, validateOnly }) => {
      try {
        const path = validateOnly ? '/orders/validate' : '/orders/purchase';
        return asJson(
          await customerApi(path, {
            method: 'POST',
            body: { slug, period, coupon },
          }),
          validateOnly
            ? 'Dry run complete — no records were created.'
            : 'Order placed. License is now active on your account; check listLicenses.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
