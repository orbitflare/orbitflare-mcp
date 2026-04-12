import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getRegion } from '../../config.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  service: z
    .enum(['jetstream', 'yellowstone'])
    .describe(
      "Which streaming product to use: 'jetstream' (ultra-low-latency shreds) or 'yellowstone' (Geyser, full metadata)",
    ),
  region: z
    .string()
    .optional()
    .describe(
      'Region code (e.g. fra, sgp, ams, ny, tok). Defaults to currently selected RPC region.',
    ),
  accountInclude: z
    .array(z.string())
    .optional()
    .describe('Pubkeys that MUST appear in a transaction'),
  accountExclude: z
    .array(z.string())
    .optional()
    .describe('Pubkeys whose transactions should be filtered out'),
  accountRequired: z
    .array(z.string())
    .optional()
    .describe('Pubkeys that ALL must be present in a transaction'),
  vote: z.boolean().optional().describe('Yellowstone only: include vote transactions'),
  failed: z.boolean().optional().describe('Yellowstone only: include failed transactions'),
  commitment: z
    .enum(['processed', 'confirmed', 'finalized'])
    .optional()
    .describe('Yellowstone only: commitment level'),
};

export function registerSubscribeTransactions(server: McpServer): void {
  server.registerTool(
    'subscribeTransactions',
    {
      title: 'Build Streaming Subscription Config',
      description:
        'OrbitFlare streaming is gRPC-based and runs as a long-lived connection — it cannot be tunneled through a stdio MCP call. This tool returns the gRPC endpoint URL and a ready-to-use YAML/JSON filter config for the OrbitFlare CLI (`orbitflare jet --config` or `orbitflare grpc --config`) or any Yellowstone/Jetstream client.',
      inputSchema,
    },
    async ({
      service,
      region,
      accountInclude,
      accountExclude,
      accountRequired,
      vote,
      failed,
      commitment,
    }) => {
      try {
        const r = region ?? getRegion();
        const reg = r === 'mainnet' || r === 'devnet' ? 'fra' : r;

        const endpoint =
          service === 'jetstream'
            ? `http://${reg}.jetstream.orbitflare.com`
            : `http://${reg}.rpc.orbitflare.com:10000`;

        const filter: Record<string, unknown> = {};
        if (accountInclude?.length) filter.account_include = accountInclude;
        if (accountExclude?.length) filter.account_exclude = accountExclude;
        if (accountRequired?.length) filter.account_required = accountRequired;

        const yamlConfig: Record<string, unknown> = {
          transactions: { my_filter: filter },
        };

        if (service === 'yellowstone') {
          if (vote !== undefined) (yamlConfig.transactions as { my_filter: Record<string, unknown> }).my_filter.vote = vote;
          if (failed !== undefined) (yamlConfig.transactions as { my_filter: Record<string, unknown> }).my_filter.failed = failed;
          if (commitment) yamlConfig.commitment = commitment;
        }

        yamlConfig.reconnect = {
          initial_delay_ms: 100,
          max_delay_ms: 30_000,
          multiplier: 2.0,
          max_retries: 0,
        };

        const cliCommand =
          service === 'jetstream'
            ? 'orbitflare jet --config stream.yml'
            : 'orbitflare grpc --config stream.yml';

        return asJson(
          {
            service,
            region: reg,
            grpcEndpoint: endpoint,
            authNote:
              'Authenticate via the x-token gRPC metadata header set to your OrbitFlare license key.',
            connectionLimitNote:
              'Shared plans cap concurrent gRPC connections to 50 per IP across all regions. Use Dedicated gRPC for higher.',
            cliCommand,
            yamlConfig,
            docs:
              service === 'jetstream'
                ? 'https://docs.orbitflare.com/data-streaming/jetstream'
                : 'https://docs.orbitflare.com/data-streaming/yellowstone',
          },
          'Save the YAML to stream.yml and run the CLI command above to begin streaming.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
