import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
} from '@solana/kit';
import { getActiveSigner } from '../../utils/keypair.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  transaction: z
    .string()
    .describe('Base-64 encoded unsigned versioned transaction (e.g. from buildSolTransfer)'),
  skipPreflight: z.boolean().optional().describe('Skip preflight simulation (default false)'),
  maxRetries: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe('Max RPC retries before the blockhash expires'),
};

export function registerSignAndSendTransaction(server: McpServer): void {
  server.registerTool(
    'signAndSendTransaction',
    {
      title: 'Sign And Send Transaction',
      description:
        'Signs a base-64 unsigned transaction with the session keypair and broadcasts it via OrbitFlare RPC. Returns the signature and a Solscan link.',
      inputSchema,
    },
    async ({ transaction, skipPreflight, maxRetries }) => {
      try {
        const signer = getActiveSigner();
        if (!signer) {
          return asError(new Error('No keypair loaded. Use generateKeypair or loadKeypair first.'));
        }
        const wireBytes = getBase64Encoder().encode(transaction);
        const decoded = getTransactionDecoder().decode(wireBytes);
        const signed = await partiallySignTransaction([signer.keyPair], decoded);
        const signedBase64 = getBase64EncodedWireTransaction(signed);

        const signature = await rpcCall<string>('sendTransaction', [
          signedBase64,
          {
            encoding: 'base64',
            skipPreflight: skipPreflight ?? false,
            maxRetries,
            preflightCommitment: 'confirmed',
          },
        ]);

        return asJson(
          {
            signature,
            explorer: `https://solscan.io/tx/${signature}`,
            feePayer: signer.address,
          },
          'Transaction submitted. Use getTransaction to verify confirmation.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
