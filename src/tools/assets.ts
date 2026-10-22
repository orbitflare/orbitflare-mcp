import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  assetCollection,
  assetImage,
  assetName,
  assetOwner,
  assetSymbol,
  isCompressed,
  proofPath,
  type Asset,
  type AssetList,
  type SearchAssetsRequest,
} from '@orbitflare/sdk';
import { asJson, lamportsToSol } from '../utils/formatters.js';
import { rpcCall, withRpc } from '../utils/rpc.js';
import { defineTool, READ } from './define.js';

const address = (what: string) => z.string().min(32).max(44).describe(what);

const paging = {
  page: z.number().int().min(1).optional().describe('1-based page number (default 1). Do not combine with cursor.'),
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().optional().describe('Cursor from a previous response, for walking large result sets'),
};

const FUNGIBLE = new Set(['FungibleToken', 'FungibleAsset']);

function isFungible(asset: Asset): boolean {
  return FUNGIBLE.has(asset.interface) || asset.ownership?.ownership_model === 'token';
}

function uiAmount(raw: number | undefined, decimals: number | undefined): number | null {
  if (raw === undefined) return null;
  return raw / 10 ** (decimals ?? 0);
}

export function summarizeAsset(asset: Asset) {
  const info = asset.token_info;
  return {
    id: asset.id,
    name: assetName(asset) ?? null,
    symbol: assetSymbol(asset) ?? info?.symbol ?? null,
    interface: asset.interface,
    owner: assetOwner(asset) || null,
    collection: assetCollection(asset) ?? null,
    compressed: isCompressed(asset),
    burnt: asset.burnt ?? false,
    mutable: asset.mutable ?? null,
    frozen: asset.ownership?.frozen ?? false,
    image: assetImage(asset) ?? null,
    royaltyBps: asset.royalty?.basis_points ?? null,
    ...(info
      ? {
          token: {
            decimals: info.decimals ?? null,
            supply: uiAmount(info.supply, info.decimals),
            priceUsd: info.price_info?.price_per_token ?? null,
            tokenProgram: info.token_program ?? null,
            mintAuthority: info.mint_authority ?? null,
            freezeAuthority: info.freeze_authority ?? null,
          },
        }
      : {}),
  };
}

function pageInfo(list: AssetList | { total: number; limit: number; page?: number; cursor?: string }, returned: number) {
  const hasMore = returned >= list.limit;
  return {
    page: list.page ?? null,
    limit: list.limit,
    returned,
    cursor: list.cursor ?? null,
    hasMore,
    ...(hasMore && list.page ? { nextPage: list.page + 1 } : {}),
  };
}

export function registerAssetTools(server: McpServer): void {
  defineTool(
    server,
    'getWalletPortfolio',
    {
      title: 'Get Wallet Portfolio',
      description:
        'Everything a wallet holds in one call via the DAS API: SOL balance, fungible SPL/Token-2022 tokens with USD prices and values where known, and NFTs / compressed NFTs / MPL Core assets. Tokens are sorted by USD value. Paginated: pass page (or cursor) to continue when hasMore is true.',
      input: {
        owner: address('Wallet address'),
        includeNfts: z.boolean().optional().describe('List NFTs individually (default true). False keeps only a count.'),
        includeZeroBalances: z.boolean().optional().describe('Include empty token accounts (default false)'),
        ...paging,
      },
      annotations: READ,
    },
    async ({ owner, includeNfts, includeZeroBalances, page, limit, cursor }) => {
      const list = await withRpc((c) =>
        c.getAssetsByOwner({
          ownerAddress: owner,
          ...(cursor ? { cursor } : { page: page ?? 1 }),
          limit: limit ?? 200,
          options: { showFungible: true, showNativeBalance: true, showZeroBalance: includeZeroBalances ?? false },
        }),
      );
      const tokens = list.items.filter(isFungible).map((a) => {
        const info = a.token_info ?? {};
        return {
          mint: a.id,
          symbol: info.symbol ?? assetSymbol(a) ?? null,
          name: assetName(a) ?? null,
          balance: uiAmount(info.balance, info.decimals),
          rawBalance: info.balance ?? null,
          decimals: info.decimals ?? null,
          priceUsd: info.price_info?.price_per_token ?? null,
          valueUsd: info.price_info?.total_price ?? null,
          tokenAccount: info.associated_token_address ?? null,
          tokenProgram: info.token_program ?? null,
        };
      });
      tokens.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
      const nfts = list.items
        .filter((a) => !isFungible(a))
        .map((a) => ({
          id: a.id,
          name: assetName(a) ?? null,
          interface: a.interface,
          collection: assetCollection(a) ?? null,
          compressed: isCompressed(a),
          image: assetImage(a) ?? null,
        }));
      const native = list.nativeBalance;
      const solUsd = native?.total_price ?? null;
      const tokensUsd = tokens.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0);
      return asJson({
        owner,
        sol: native
          ? {
              lamports: native.lamports,
              sol: lamportsToSol(native.lamports),
              priceUsd: native.price_per_sol ?? null,
              valueUsd: solUsd,
            }
          : null,
        totals: {
          solUsd,
          tokensUsd: +tokensUsd.toFixed(2),
          totalUsd: +((solUsd ?? 0) + tokensUsd).toFixed(2),
          tokenCount: tokens.length,
          nftCount: nfts.length,
          note: 'USD totals cover priced assets on this page only.',
        },
        tokens,
        ...(includeNfts === false ? {} : { nfts }),
        paging: pageInfo(list, list.items.length),
      });
    },
  );

  defineTool(
    server,
    'getAsset',
    {
      title: 'Get Asset',
      description:
        'Looks up one or many digital assets (NFT, compressed NFT, MPL Core asset, or fungible token mint) via the DAS API. Pass id for one asset (full detail) or ids for a batch (summaries). For a compressed NFT, withProof adds the Merkle proof needed for Bubblegum transfer/burn instructions, and history adds the transactions that changed it.',
      input: {
        id: z.string().optional().describe('Asset id (mint address for NFTs and tokens)'),
        ids: z.array(z.string()).min(1).max(1000).optional().describe('Batch of asset ids'),
        detail: z
          .enum(['summary', 'full'])
          .optional()
          .describe('summary = key fields; full = complete DAS asset object. Default full for id, summary for ids.'),
        withProof: z.boolean().optional().describe('Compressed NFTs only: include the Merkle proof (single id)'),
        canopyDepth: z
          .number()
          .int()
          .min(0)
          .max(30)
          .optional()
          .describe('With withProof: tree canopy depth, to return the trimmed proofPath a transaction must pass'),
        history: z.boolean().optional().describe('Compressed NFTs: include signatures that changed the asset (single id)'),
        historyPage: z.number().int().min(1).optional(),
        historyLimit: z.number().int().min(1).max(1000).optional(),
        showCollectionMetadata: z.boolean().optional(),
        showUnverifiedCollections: z.boolean().optional(),
      },
      annotations: READ,
    },
    async (args) => {
      if (!args.id && !args.ids) throw new Error('Pass id or ids.');
      const options = {
        showFungible: true,
        showCollectionMetadata: args.showCollectionMetadata,
        showUnverifiedCollections: args.showUnverifiedCollections,
      };
      if (args.ids) {
        const assets = await withRpc((c) => c.getAssetBatch(args.ids!, options));
        const full = args.detail === 'full';
        return asJson({
          count: assets.length,
          missing: args.ids.filter((_, i) => assets[i] === null),
          assets: assets.map((a) => (a === null ? null : full ? a : summarizeAsset(a))),
        });
      }
      const id = args.id!;
      const [assetOrProof, history] = await Promise.all([
        args.withProof
          ? withRpc((c) => c.getAssetWithProof(id, options))
          : withRpc((c) => c.getAsset(id, options)).then((asset) => ({ asset, proof: undefined })),
        args.history
          ? withRpc((c) =>
              c.getSignaturesForAsset({ id, page: args.historyPage ?? 1, limit: args.historyLimit ?? 50 }),
            )
          : Promise.resolve(undefined),
      ]);
      const { asset, proof } = assetOrProof;
      return asJson({
        summary: summarizeAsset(asset),
        ...(args.detail === 'summary' ? {} : { asset }),
        ...(proof
          ? {
              proof: {
                ...proof,
                ...(args.canopyDepth !== undefined ? { proofPath: proofPath(proof, args.canopyDepth) } : {}),
              },
            }
          : {}),
        ...(history
          ? {
              history: {
                total: history.total,
                page: history.page ?? null,
                limit: history.limit,
                items: history.items,
              },
            }
          : {}),
      });
    },
  );

  defineTool(
    server,
    'searchAssets',
    {
      title: 'Search Assets',
      description:
        'Finds digital assets with DAS searchAssets: by owner, creator, update authority, collection, token type, name, compression, burnt/frozen state and more. Filters combine with AND (conditionType "any" for OR). Use it for "all NFTs in collection X", "assets created by Y", "compressed NFTs owned by Z". Paginated by page or cursor.',
      input: {
        ownerAddress: z.string().optional(),
        creatorAddress: z.string().optional(),
        creatorVerified: z.boolean().optional(),
        authorityAddress: z.string().optional(),
        collection: z.string().optional().describe('Collection address (grouping collection=<address>)'),
        tokenType: z
          .enum(['fungible', 'nonFungible', 'regularNFT', 'compressedNFT', 'all'])
          .optional()
          .describe('Needed by some queries when ownerAddress is set; "all" includes fungible tokens'),
        interface: z.string().optional().describe('e.g. V1_NFT, ProgrammableNFT, MplCoreAsset, FungibleToken'),
        name: z.string().optional().describe('Exact asset name (requires ownerAddress)'),
        compressed: z.boolean().optional(),
        burnt: z.boolean().optional(),
        frozen: z.boolean().optional(),
        jsonUri: z.string().optional(),
        conditionType: z.enum(['all', 'any']).optional(),
        sortBy: z.enum(['id', 'created', 'updated', 'recent_action', 'none']).optional(),
        sortDirection: z.enum(['asc', 'desc']).optional(),
        detail: z.enum(['summary', 'full']).optional().describe('Default summary'),
        ...paging,
      },
      annotations: READ,
    },
    async (args) => {
      const req: SearchAssetsRequest = {
        ownerAddress: args.ownerAddress,
        creatorAddress: args.creatorAddress,
        creatorVerified: args.creatorVerified,
        authorityAddress: args.authorityAddress,
        grouping: args.collection ? ['collection', args.collection] : undefined,
        tokenType: args.tokenType,
        interface: args.interface,
        name: args.name,
        compressed: args.compressed,
        burnt: args.burnt,
        frozen: args.frozen,
        jsonUri: args.jsonUri,
        conditionType: args.conditionType,
        sortBy: args.sortBy ? { sortBy: args.sortBy, sortDirection: args.sortDirection } : undefined,
        limit: args.limit ?? 50,
        ...(args.cursor ? { cursor: args.cursor } : { page: args.page ?? 1 }),
      };
      const clean = Object.fromEntries(Object.entries(req).filter(([, v]) => v !== undefined)) as SearchAssetsRequest;
      const list = await withRpc((c) => c.searchAssets(clean));
      return asJson({
        items: args.detail === 'full' ? list.items : list.items.map(summarizeAsset),
        paging: pageInfo(list, list.items.length),
      });
    },
  );

  defineTool(
    server,
    'getTokenHolders',
    {
      title: 'Get Token Holders',
      description:
        'Lists token accounts for an SPL / Token-2022 mint (who holds it and how much) via DAS getTokenAccounts, with the mint supply and each holder\'s share of it. Optionally narrow to one owner. DAS pages through accounts in address order, not by balance: each page is sorted by balance, but the first page is not the largest holders. For the top 20 holders try rpcRequest getTokenLargestAccounts (it can fail on mints with very many accounts).',
      input: {
        mint: address('Token mint address'),
        owner: z.string().optional().describe('Only this wallet\'s accounts for the mint'),
        includeZeroBalances: z.boolean().optional(),
        ...paging,
      },
      annotations: READ,
    },
    async ({ mint, owner, includeZeroBalances, page, limit, cursor }) => {
      const [list, supply] = await Promise.all([
        withRpc((c) =>
          c.getTokenAccounts({
            mint,
            owner,
            limit: limit ?? 100,
            ...(cursor ? { cursor } : { page: page ?? 1 }),
            options: { showZeroBalance: includeZeroBalances ?? false },
          }),
        ),
        rpcCall<{ value: { amount: string; decimals: number; uiAmountString: string } }>('getTokenSupply', [mint]).catch(
          () => null,
        ),
      ]);
      const decimals = supply?.value.decimals;
      const total = supply ? Number(supply.value.amount) : null;
      const holders = list.token_accounts
        .map((a) => ({
          tokenAccount: a.address,
          owner: a.owner,
          amount: a.amount,
          uiAmount: decimals === undefined ? null : a.amount / 10 ** decimals,
          sharePct: total ? +((a.amount / total) * 100).toFixed(6) : null,
          frozen: a.frozen,
          delegate: a.delegate,
        }))
        .sort((a, b) => b.amount - a.amount);
      return asJson({
        mint,
        supply: supply ? { amount: supply.value.amount, decimals, uiAmount: supply.value.uiAmountString } : null,
        holders,
        paging: pageInfo(list, list.token_accounts.length),
      });
    },
  );
}
