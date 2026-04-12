import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  REGIONS,
  setApiKey,
  setCustomerApiKey,
  setNetwork,
  setRegion,
  type Region,
} from '../../config.js';
import { asError, asText } from '../../utils/formatters.js';

const inputSchema = {
  apiKey: z.string().min(8).describe('OrbitFlare key value'),
  kind: z
    .enum(['rpc', 'customer'])
    .optional()
    .describe(
      "Which key to set: 'rpc' (license key for JSON-RPC, default) or 'customer' (Customer API key)",
    ),
  network: z
    .enum(['mainnet', 'devnet'])
    .optional()
    .describe('Optionally switch network at the same time'),
  region: z
    .enum(REGIONS as [string, ...string[]])
    .optional()
    .describe(
      'Optionally pin a specific region endpoint (e.g. fra, sgp, ny). Defaults to auto-routed.',
    ),
};

export function registerSetApiKey(server: McpServer): void {
  server.registerTool(
    'setApiKey',
    {
      title: 'Set OrbitFlare API Key',
      description:
        'Stores an OrbitFlare key for the current MCP session. Use kind="rpc" for the license key (JSON-RPC) or kind="customer" for the Customer API. You can also switch network or pin a region.',
      inputSchema,
    },
    async ({ apiKey, kind, network, region }) => {
      try {
        const k = kind ?? 'rpc';
        if (k === 'customer') {
          setCustomerApiKey(apiKey);
        } else {
          setApiKey(apiKey);
        }
        if (network) setNetwork(network);
        if (region) setRegion(region as Region);
        const tail = [
          network ? `network=${network}` : null,
          region ? `region=${region}` : null,
        ]
          .filter(Boolean)
          .join(', ');
        return asText(
          `Stored ${k} API key for the current session${tail ? ` (${tail})` : ''}.`,
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
