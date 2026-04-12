import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../../utils/rpc.js';
import { asError, asJson } from '../../utils/formatters.js';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const inputSchema = {
  owner: z.string().describe('Wallet address that owns the token accounts'),
  programId: z
    .enum([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID])
    .optional()
    .describe('SPL Token program (default: classic Token program)'),
  mint: z
    .string()
    .optional()
    .describe('Filter by a specific token mint instead of program'),
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
};

interface ParsedAccount {
  pubkey: string;
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          owner: string;
          tokenAmount: {
            amount: string;
            decimals: number;
            uiAmount: number | null;
            uiAmountString: string;
          };
        };
      };
    };
  };
}

export function registerGetTokenAccountsByOwner(server: McpServer): void {
  server.registerTool(
    'getTokenAccountsByOwner',
    {
      title: 'Get Token Accounts By Owner',
      description:
        'Returns all SPL token accounts owned by a wallet, with mint, balance, and decimals. Filter by `mint` for a single token or `programId` for Token-2022.',
      inputSchema,
    },
    async ({ owner, programId, mint, commitment }) => {
      try {
        const filter = mint ? { mint } : { programId: programId ?? TOKEN_PROGRAM_ID };
        const result = await rpcCall<{
          context: { slot: number };
          value: ParsedAccount[];
        }>('getTokenAccountsByOwner', [
          owner,
          filter,
          { encoding: 'jsonParsed', commitment: commitment ?? 'confirmed' },
        ]);

        const summary = result.value.map((a) => ({
          tokenAccount: a.pubkey,
          mint: a.account.data.parsed.info.mint,
          amount: a.account.data.parsed.info.tokenAmount.uiAmountString,
          decimals: a.account.data.parsed.info.tokenAmount.decimals,
        }));

        return asJson(
          { owner, slot: result.context.slot, count: summary.length, tokens: summary },
          `Found ${summary.length} token account(s) for ${owner}.`,
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
