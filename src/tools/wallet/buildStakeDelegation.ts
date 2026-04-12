import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { getDelegateStakeInstruction } from '@solana-program/stake';
import { getActiveSigner } from '../../utils/keypair.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const ORBITFLARE_VOTE_ACCOUNT = '68q1YeY3QJoL3DF3umVKkCFARYh931sQTbZbRtYthGu9';

const STAKE_HISTORY_SYSVAR = 'SysvarStakeHistory1111111111111111111111111';
const CLOCK_SYSVAR = 'SysvarC1ock11111111111111111111111111111111';
const STAKE_CONFIG = 'StakeConfig11111111111111111111111111111111';

const inputSchema = {
  stakeAccount: z
    .string()
    .describe(
      "Existing stake account address (must already exist and be initialized; this tool only emits the delegate instruction)",
    ),
  voteAccount: z
    .string()
    .optional()
    .describe(
      `Vote account to delegate to (defaults to OrbitFlare's validator vote account ${ORBITFLARE_VOTE_ACCOUNT})`,
    ),
};

export function registerBuildStakeDelegation(server: McpServer): void {
  server.registerTool(
    'buildStakeDelegation',
    {
      title: 'Build Stake Delegation Transaction',
      description:
        "Builds an unsigned versioned transaction that delegates an existing stake account to a vote account (defaults to OrbitFlare's validator). The session keypair must be the stake authority. Pass the result to signAndSendTransaction.",
      inputSchema,
    },
    async ({ stakeAccount, voteAccount }) => {
      try {
        const signer = getActiveSigner();
        if (!signer) {
          return asError(new Error('No keypair loaded. Use generateKeypair or loadKeypair first.'));
        }
        const blockhashResp = await rpcCall<{
          value: { blockhash: string; lastValidBlockHeight: number };
        }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);

        const ix = getDelegateStakeInstruction({
          stake: address(stakeAccount),
          vote: address(voteAccount ?? ORBITFLARE_VOTE_ACCOUNT),
          clockSysvar: address(CLOCK_SYSVAR),
          stakeHistory: address(STAKE_HISTORY_SYSVAR),
          unused: address(STAKE_CONFIG),
          stakeAuthority: signer,
        });

        const msg = pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayer(signer.address, m),
          (m) =>
            setTransactionMessageLifetimeUsingBlockhash(
              {
                blockhash: blockhashResp.value.blockhash as Parameters<
                  typeof setTransactionMessageLifetimeUsingBlockhash
                >[0]['blockhash'],
                lastValidBlockHeight: BigInt(blockhashResp.value.lastValidBlockHeight),
              },
              m,
            ),
          (m) => appendTransactionMessageInstruction(ix, m),
        );

        const compiled = compileTransaction(msg);
        const wire = getBase64EncodedWireTransaction(compiled);

        return asJson(
          {
            transaction: wire,
            feePayer: signer.address,
            stakeAccount,
            voteAccount: voteAccount ?? ORBITFLARE_VOTE_ACCOUNT,
            blockhash: blockhashResp.value.blockhash,
            lastValidBlockHeight: blockhashResp.value.lastValidBlockHeight,
          },
          'Unsigned delegation transaction built. Sign with the stake authority and broadcast via signAndSendTransaction.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
