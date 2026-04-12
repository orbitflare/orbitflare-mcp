import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const inputSchema = {
  signedTransaction: z
    .string()
    .describe('Base-64 encoded fully-signed transaction'),
  encoding: z
    .enum(['base64', 'base58'])
    .optional()
    .describe('Encoding of the signed transaction (default: base64)'),
  skipPreflight: z
    .boolean()
    .optional()
    .describe('Skip simulation before submission (default: false)'),
  maxRetries: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe('Max RPC retries before the blockhash expires'),
  preflightCommitment: z
    .enum(['processed', 'confirmed', 'finalized'])
    .optional(),
};

export function registerSendTransaction(server: McpServer): void {
  server.registerTool(
    'sendTransaction',
    {
      title: 'Send Transaction',
      description:
        'Submits a signed transaction to the Solana cluster via OrbitFlare. The transaction must already be signed; this tool does NOT sign on your behalf.',
      inputSchema,
    },
    async ({
      signedTransaction,
      encoding,
      skipPreflight,
      maxRetries,
      preflightCommitment,
    }) => {
      try {
        const signature = await rpcCall<string>('sendTransaction', [
          signedTransaction,
          {
            encoding: encoding ?? 'base64',
            skipPreflight: skipPreflight ?? false,
            maxRetries,
            preflightCommitment: preflightCommitment ?? 'confirmed',
          },
        ]);
        return asJson(
          {
            signature,
            explorer: `https://solscan.io/tx/${signature}`,
          },
          `Transaction submitted. Use getTransaction to confirm landing.`,
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
