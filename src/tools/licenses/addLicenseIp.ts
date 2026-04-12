import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  licenseId: z.union([z.number().int().positive(), z.string()]),
  ip: z.string().describe('IPv4 or IPv6 address to whitelist'),
  locationId: z
    .union([z.number().int(), z.string()])
    .optional()
    .describe('Optional location/region ID'),
};

export function registerAddLicenseIp(server: McpServer): void {
  server.registerTool(
    'addLicenseIp',
    {
      title: 'Add IP To License Whitelist',
      description:
        'Whitelists an IP address on a license, optionally pinned to a specific location. Required for IP-mode licenses before the IP can use the RPC.',
      inputSchema,
    },
    async ({ licenseId, ip, locationId }) => {
      try {
        return asJson(
          await customerApi(`/licenses/${licenseId}/whitelist-ips`, {
            method: 'POST',
            body: { ip, location_id: locationId },
          }),
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
