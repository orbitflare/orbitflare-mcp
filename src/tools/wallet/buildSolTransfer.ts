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
import { getTransferSolInstruction } from '@solana-program/system';
import { getActiveSigner } from '../../utils/keypair.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  recipient: z.string().describe('Destination wallet address'),
  amountSol: z
    .number()
    .positive()
    .max(10000)
    .describe('Amount of SOL to transfer'),
};

export function registerBuildSolTransfer(server: McpServer): void {
  server.registerTool(
    'buildSolTransfer',
    {
      title: 'Build SOL Transfer Transaction',
      description:
        'Builds an unsigned base-64 versioned transaction transferring SOL from the loaded session keypair to a recipient. The fee-payer is the loaded wallet. Pass the result to signAndSendTransaction (or your own signer) to broadcast.',
      inputSchema,
    },
    async ({ recipient, amountSol }) => {
      try {
        const signer = getActiveSigner();
        if (!signer) {
          return asError(new Error('No keypair loaded. Use generateKeypair or loadKeypair first.'));
        }
        const blockhashResp = await rpcCall<{
          context: { slot: number };
          value: { blockhash: string; lastValidBlockHeight: number };
        }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);

        const lamports = BigInt(Math.round(amountSol * 1_000_000_000));
        const recipientAddr = address(recipient);

        const ix = getTransferSolInstruction({
          source: signer,
          destination: recipientAddr,
          amount: lamports,
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
            recipient,
            amountSol,
            lamports: lamports.toString(),
            blockhash: blockhashResp.value.blockhash,
            lastValidBlockHeight: blockhashResp.value.lastValidBlockHeight,
          },
          'Unsigned transaction built. Use signAndSendTransaction to sign with the session keypair and broadcast.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
