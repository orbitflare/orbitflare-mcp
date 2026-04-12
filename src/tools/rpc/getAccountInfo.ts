import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  address: z.string().min(32).max(48).describe('Account public key (base-58)'),
  encoding: z
    .enum(['base58', 'base64', 'base64+zstd', 'jsonParsed'])
    .optional()
    .describe('Account data encoding (default: jsonParsed)'),
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
};

export function registerGetAccountInfo(server: McpServer): void {
  server.registerTool(
    'getAccountInfo',
    {
      title: 'Get Account Info',
      description:
        'Returns full account information for a Solana address: lamports, owner program, executable flag, rent epoch, and decoded data when available.',
      inputSchema,
    },
    async ({ address, encoding, commitment }) => {
      try {
        const result = await rpcCall('getAccountInfo', [
          address,
          {
            encoding: encoding ?? 'jsonParsed',
            commitment: commitment ?? 'confirmed',
          },
        ]);
        return asJson(result);
      } catch (err) {
        return asError(err);
      }
    },
  );
}
