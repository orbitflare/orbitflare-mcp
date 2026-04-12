import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const ORBITFLARE_VALIDATOR = {
  identity: 'orbit1bWKxnECKLqjhm5rybTiEC2GEYbecyebgEfM5q',
  voteAccount: '68q1YeY3QJoL3DF3umVKkCFARYh931sQTbZbRtYthGu9',
  commissionPct: 5,
  estimatedApyPct: 6.18,
  jitoMevEnabled: true,
};

const inputSchema = {
  amountSol: z
    .number()
    .positive()
    .optional()
    .describe('Optional amount of SOL to estimate rewards for'),
  liveStats: z
    .boolean()
    .optional()
    .describe(
      'If true, fetch live activated stake from the network via getVoteAccounts (slower, requires RPC key).',
    ),
};

interface VoteAccount {
  votePubkey: string;
  nodePubkey: string;
  activatedStake: number;
  commission: number;
  epochCredits: [number, number, number][];
  lastVote: number;
}

export function registerGetStakeInfo(server: McpServer): void {
  server.registerTool(
    'getStakeInfo',
    {
      title: 'Get OrbitFlare Validator Staking Info',
      description:
        "Returns OrbitFlare's validator identity, vote account, commission, and estimated APY. Optionally estimates rewards for an amount of SOL or fetches live activated stake from the network.",
      inputSchema,
    },
    async ({ amountSol, liveStats }) => {
      try {
        const out: Record<string, unknown> = { ...ORBITFLARE_VALIDATOR };

        if (amountSol !== undefined) {
          const yearly = amountSol * (ORBITFLARE_VALIDATOR.estimatedApyPct / 100);
          out.estimatedRewards = {
            inputSol: amountSol,
            daily: +(yearly / 365).toFixed(6),
            monthly: +(yearly / 12).toFixed(6),
            yearly: +yearly.toFixed(6),
            note: 'Estimates assume current network conditions; actual rewards vary.',
          };
        }

        if (liveStats) {
          try {
            const result = await rpcCall<{
              current: VoteAccount[];
              delinquent: VoteAccount[];
            }>('getVoteAccounts', [
              { votePubkey: ORBITFLARE_VALIDATOR.voteAccount },
            ]);
            const all = [...result.current, ...result.delinquent];
            const me = all.find(
              (v) => v.votePubkey === ORBITFLARE_VALIDATOR.voteAccount,
            );
            if (me) {
              out.live = {
                activatedSol: me.activatedStake / 1_000_000_000,
                commission: me.commission,
                lastVote: me.lastVote,
                delinquent: result.delinquent.some(
                  (v) => v.votePubkey === ORBITFLARE_VALIDATOR.voteAccount,
                ),
              };
            } else {
              out.live = { error: 'Validator not found in vote accounts response.' };
            }
          } catch (e) {
            out.live = {
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }

        out.howToStake = {
          step1: 'Open any Solana wallet (Phantom, Solflare, Backpack).',
          step2: `Delegate stake to vote account ${ORBITFLARE_VALIDATOR.voteAccount}`,
          step3: 'Rewards distribute automatically every epoch (~2-3 days).',
          docs: 'https://docs.orbitflare.com/staking',
        };

        return asJson(out);
      } catch (err) {
        return asError(err);
      }
    },
  );
}
