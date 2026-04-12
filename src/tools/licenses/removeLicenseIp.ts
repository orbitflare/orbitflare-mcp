import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  licenseId: z.union([z.number().int().positive(), z.string()]),
  ip: z.string().describe('Whitelisted IP to remove'),
  locationId: z
    .union([z.number().int(), z.string()])
    .optional()
    .describe('Optional location/region ID the IP was scoped to'),
};

export function registerRemoveLicenseIp(server: McpServer): void {
  server.registerTool(
    'removeLicenseIp',
    {
      title: 'Remove IP From License Whitelist',
      description: 'Removes a previously whitelisted IP from a license.',
      inputSchema,
    },
    async ({ licenseId, ip, locationId }) => {
      try {
        const query: Record<string, string | number | undefined> = { ip };
        if (locationId !== undefined) query.location_id = String(locationId);
        return asJson(
          await customerApi(`/licenses/${licenseId}/whitelist-ips`, {
            method: 'DELETE',
            query,
          }),
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
