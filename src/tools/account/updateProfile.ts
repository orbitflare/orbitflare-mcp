import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  name: z.string().optional().describe('Display name'),
  email: z.string().email().optional().describe('Email address'),
  payment_wallet_address: z
    .string()
    .optional()
    .describe('Solana wallet to associate with payments'),
};

export function registerUpdateProfile(server: McpServer): void {
  server.registerTool(
    'updateProfile',
    {
      title: 'Update Profile',
      description: 'Updates name, email, or payment wallet on the authenticated OrbitFlare account.',
      inputSchema,
    },
    async (args) => {
      try {
        const body = Object.fromEntries(
          Object.entries(args).filter(([, v]) => v !== undefined),
        );
        if (Object.keys(body).length === 0) {
          return asError(new Error('Provide at least one field to update.'));
        }
        return asJson(
          await customerApi('/profile', { method: 'PATCH', body }),
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
