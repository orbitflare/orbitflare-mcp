import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson, lamportsToSol } from '../../utils/formatters.js';

const inputSchema = {
  stakeAccount: z.string().describe('Stake account address'),
  epoch: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Epoch to query (default: current)'),
};

interface StakeActivation {
  state: 'active' | 'inactive' | 'activating' | 'deactivating';
  active: number;
  inactive: number;
}

export function registerGetStakeActivation(server: McpServer): void {
  server.registerTool(
    'getStakeActivation',
    {
      title: 'Get Stake Activation',
      description:
        'Returns the activation state of a stake account: state (active/inactive/activating/deactivating) plus active and inactive lamport amounts.',
      inputSchema,
    },
    async ({ stakeAccount, epoch }) => {
      try {
        const result = await rpcCall<StakeActivation>('getStakeActivation', [
          stakeAccount,
          epoch !== undefined ? { epoch } : {},
        ]);
        return asJson({
          stakeAccount,
          state: result.state,
          activeSol: lamportsToSol(result.active),
          inactiveSol: lamportsToSol(result.inactive),
          raw: result,
        });
      } catch (err) {
        return asError(err);
      }
    },
  );
}
