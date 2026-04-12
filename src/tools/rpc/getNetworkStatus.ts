import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';
import { getRegion, getRpcUrl } from '../../config.js';

export function registerGetNetworkStatus(server: McpServer): void {
  server.registerTool(
    'getNetworkStatus',
    {
      title: 'Get OrbitFlare Network Status',
      description:
        'Returns a consolidated network status: node health, software version, validator identity, current slot, and the configured OrbitFlare endpoint.',
      inputSchema: {},
    },
    async () => {
      try {
        const settled = await Promise.allSettled([
          rpcCall<string>('getHealth'),
          rpcCall<{ 'solana-core': string; 'feature-set'?: number }>('getVersion'),
          rpcCall<{ identity: string }>('getIdentity'),
          rpcCall<number>('getSlot', [{ commitment: 'confirmed' }]),
        ]);
        const valueOr = <T,>(s: PromiseSettledResult<T>, fallback: unknown): unknown =>
          s.status === 'fulfilled' ? s.value : { error: String((s.reason as Error)?.message ?? fallback) };
        return asJson({
          endpoint: getRpcUrl(),
          region: getRegion(),
          health: valueOr(settled[0], 'unknown'),
          version: valueOr(settled[1], 'unknown'),
          identity: valueOr(settled[2], 'unknown'),
          slot: valueOr(settled[3], 'unknown'),
        });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
