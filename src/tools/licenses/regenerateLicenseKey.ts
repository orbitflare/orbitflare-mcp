import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  licenseId: z.union([z.number().int().positive(), z.string()]),
};

export function registerRegenerateLicenseKey(server: McpServer): void {
  server.registerTool(
    'regenerateLicenseKey',
    {
      title: 'Regenerate License Key',
      description:
        'Regenerates the RPC license key for a license. The old key is immediately invalidated. Update any clients that use it.',
      inputSchema,
    },
    async ({ licenseId }) => {
      try {
        return asJson(
          await customerApi(`/licenses/${licenseId}/regenerate-key`, {
            method: 'POST',
          }),
          'IMPORTANT: the old license key is now invalid. Update your applications.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
