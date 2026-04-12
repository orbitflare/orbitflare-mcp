import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_PATH = resolve(__dirname, '..', 'dist', 'index.js');
const SKIP_NETWORK = process.env.SKIP_NETWORK === '1';

const EXPECTED_TOOLS = [
  // session
  'setApiKey',
  // RPC
  'getBalance',
  'getAccountInfo',
  'getTransaction',
  'getSignaturesForAddress',
  'getBlock',
  'getTokenAccountsByOwner',
  'sendTransaction',
  'getRecentPrioritizationFees',
  'getSlot',
  'getEpochInfo',
  'getNetworkStatus',
  'getLatestBlockhash',
  'getFeeForMessage',
  'getMinimumBalanceForRentExemption',
  'getTokenSupply',
  'getTokenAccountBalance',
  'getMultipleAccounts',
  'getProgramAccounts',
  'simulateTransaction',
  'getStakeActivation',
  // account / customer api
  'getProfile',
  'updateProfile',
  'listLicenses',
  'listRpcPlans',
  // auth
  'requestDeviceCode',
  'pollDeviceToken',
  'revokeToken',
  'requestWalletChallenge',
  'verifyWalletSignature',
  'registerWithWallet',
  // api keys
  'listApiKeys',
  'createApiKey',
  'regenerateApiKey',
  'deleteApiKey',
  // licenses
  'addLicenseIp',
  'removeLicenseIp',
  'regenerateLicenseKey',
  // billing
  'prepareTopUp',
  'confirmTopUp',
  'listInvoices',
  'purchaseRpcPlan',
  // streaming / staking / swap
  'subscribeTransactions',
  'getStakeInfo',
  'getSwapQuote',
  // wallet
  'generateKeypair',
  'getWalletAddress',
  'loadKeypair',
  'clearKeypair',
  'signMessage',
  'buildSolTransfer',
  'buildStakeDelegation',
  'signAndSendTransaction',
];

const EXPECTED_RESOURCES = [
  'orbitflare://docs/index',
  'orbitflare://docs/quickstart',
  'orbitflare://docs/authentication',
  'orbitflare://docs/products',
  'orbitflare://docs/jetstream',
  'orbitflare://docs/yellowstone',
  'orbitflare://docs/rpc-http',
  'orbitflare://docs/staking',
  'orbitflare://docs/metis-swap',
  'orbitflare://docs/cli',
  'orbitflare://docs/customer-api',
];

interface ToolHandle {
  client: Client;
  transport: StdioClientTransport;
  dispose: () => Promise<void>;
}

async function spawnServer(env: Record<string, string> = {}): Promise<ToolHandle> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, ...env } as Record<string, string>,
    stderr: 'pipe',
  });

  const client = new Client(
    { name: 'orbitflare-mcp-tests', version: '0.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);

  return {
    client,
    transport,
    async dispose() {
      try {
        await client.close();
      } catch {
        // ignore
      }
    },
  };
}

interface ToolResultText {
  text: string;
  isError: boolean;
}

function extractText(result: unknown): ToolResultText {
  const r = result as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = (r.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n');
  return { text, isError: r.isError === true };
}

function extractJsonBlock(text: string): unknown {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

describe('OrbitFlare MCP server', () => {
  let handle: ToolHandle;

  beforeAll(async () => {
    handle = await spawnServer();
  });

  afterAll(async () => {
    await handle?.dispose();
  });

  it('lists all expected tools', async () => {
    const { tools } = await handle.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    expect(names.length).toBe(EXPECTED_TOOLS.length);
    for (const t of tools) {
      expect(t.description).toBeTruthy();
    }
  });

  it('lists all 11 expected doc resources', async () => {
    const { resources } = await handle.client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual([...EXPECTED_RESOURCES].sort());
  });

  it('setApiKey stores a key and accepts network/region switches', async () => {
    const result = await handle.client.callTool({
      name: 'setApiKey',
      arguments: {
        apiKey: 'dummy-key-12345678',
        network: 'devnet',
        region: 'fra',
      },
    });
    const { text, isError } = extractText(result);
    expect(isError).toBe(false);
    expect(text).toMatch(/Stored rpc API key/);
    expect(text).toMatch(/network=devnet/);
    expect(text).toMatch(/region=fra/);
  });

  it('getStakeInfo returns validator info and reward estimate', async () => {
    const result = await handle.client.callTool({
      name: 'getStakeInfo',
      arguments: { amountSol: 100 },
    });
    const { text, isError } = extractText(result);
    expect(isError).toBe(false);
    const json = extractJsonBlock(text) as {
      voteAccount: string;
      identity: string;
      estimatedApyPct: number;
      estimatedRewards: { yearly: number; monthly: number };
      howToStake: { docs: string };
    };
    expect(json.voteAccount).toBe('68q1YeY3QJoL3DF3umVKkCFARYh931sQTbZbRtYthGu9');
    expect(json.identity).toBe('orbit1bWKxnECKLqjhm5rybTiEC2GEYbecyebgEfM5q');
    expect(json.estimatedApyPct).toBeCloseTo(6.18, 2);
    expect(json.estimatedRewards.yearly).toBeCloseTo(6.18, 2);
    expect(json.estimatedRewards.monthly).toBeGreaterThan(0);
    expect(json.howToStake.docs).toContain('docs.orbitflare.com');
  });

  it('subscribeTransactions builds a Jetstream config', async () => {
    const result = await handle.client.callTool({
      name: 'subscribeTransactions',
      arguments: {
        service: 'jetstream',
        region: 'fra',
        accountInclude: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'],
      },
    });
    const { text, isError } = extractText(result);
    expect(isError).toBe(false);
    const json = extractJsonBlock(text) as {
      service: string;
      grpcEndpoint: string;
      yamlConfig: { transactions: { my_filter: { account_include: string[] } } };
      cliCommand: string;
    };
    expect(json.service).toBe('jetstream');
    expect(json.grpcEndpoint).toBe('http://fra.jetstream.orbitflare.com');
    expect(json.cliCommand).toContain('orbitflare jet');
    expect(json.yamlConfig.transactions.my_filter.account_include).toEqual([
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    ]);
  });

  it('subscribeTransactions builds a Yellowstone config with vote/failed flags', async () => {
    const result = await handle.client.callTool({
      name: 'subscribeTransactions',
      arguments: {
        service: 'yellowstone',
        region: 'ams',
        vote: false,
        failed: false,
        commitment: 'confirmed',
      },
    });
    const { text, isError } = extractText(result);
    expect(isError).toBe(false);
    const json = extractJsonBlock(text) as {
      service: string;
      grpcEndpoint: string;
      yamlConfig: {
        commitment: string;
        transactions: { my_filter: { vote: boolean; failed: boolean } };
      };
    };
    expect(json.service).toBe('yellowstone');
    expect(json.grpcEndpoint).toBe('http://ams.rpc.orbitflare.com:10000');
    expect(json.yamlConfig.commitment).toBe('confirmed');
    expect(json.yamlConfig.transactions.my_filter.vote).toBe(false);
    expect(json.yamlConfig.transactions.my_filter.failed).toBe(false);
  });

  it.skipIf(SKIP_NETWORK)(
    'getSwapQuote fetches a live Jupiter quote for SOL->USDC',
    async () => {
      const result = await handle.client.callTool({
        name: 'getSwapQuote',
        arguments: {
          inputMint: 'SOL',
          outputMint: 'USDC',
          amount: 10000000,
          slippageBps: 50,
        },
      });
      const { text, isError } = extractText(result);
      expect(isError).toBe(false);
      const json = extractJsonBlock(text) as {
        quote: {
          inputMint: string;
          outputMint: string;
          inAmount: string;
          outAmount: string;
        };
      };
      expect(json.quote.inputMint).toBe('So11111111111111111111111111111111111111112');
      expect(json.quote.outputMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(json.quote.inAmount).toBe('10000000');
      expect(Number(json.quote.outAmount)).toBeGreaterThan(0);
    },
  );

  it.skipIf(SKIP_NETWORK)(
    'fetches the quickstart doc resource over the network',
    async () => {
      const result = await handle.client.readResource({
        uri: 'orbitflare://docs/quickstart',
      });
      const text = (result.contents[0] as { text: string }).text;
      expect(text.length).toBeGreaterThan(100);
      expect(text).toMatch(/Quickstart|OrbitFlare/i);
    },
  );
});

describe('OrbitFlare MCP — no API key configured', () => {
  let handle: ToolHandle;

  beforeAll(async () => {
    handle = await spawnServer({
      ORBITFLARE_API_KEY: '',
      ORBITFLARE_LICENSE_KEY: '',
      ORBITFLARE_CUSTOMER_API_KEY: '',
      ORBITFLARE_RPC_URL: '',
    });
  });

  afterAll(async () => {
    await handle?.dispose();
  });

  it('getBalance returns a helpful error when no RPC key is set', async () => {
    const result = await handle.client.callTool({
      name: 'getBalance',
      arguments: { address: '11111111111111111111111111111111' },
    });
    const { text, isError } = extractText(result);
    expect(isError).toBe(true);
    expect(text.toLowerCase()).toMatch(/license key|api key/);
  });

  it('getProfile returns a helpful error when no Customer API key is set', async () => {
    const result = await handle.client.callTool({
      name: 'getProfile',
      arguments: {},
    });
    const { text, isError } = extractText(result);
    expect(isError).toBe(true);
    expect(text.toLowerCase()).toMatch(/customer api (key|credential)|api key/);
  });
});

describe('OrbitFlare MCP — wallet flow (offline)', () => {
  let handle: ToolHandle;
  // sandboxed home so persisted keypair doesn't pollute the real one
  const tmpHome = resolve(__dirname, '..', '.tmp-home-wallet');

  beforeAll(async () => {
    handle = await spawnServer({
      HOME: tmpHome,
      ORBITFLARE_API_KEY: '',
      ORBITFLARE_LICENSE_KEY: '',
      ORBITFLARE_CUSTOMER_API_KEY: '',
      ORBITFLARE_BEARER_TOKEN: '',
      ORBITFLARE_RPC_URL: '',
    });
  });

  afterAll(async () => {
    await handle?.dispose();
    try {
      const { rmSync } = await import('node:fs');
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('generates a keypair, signs a message, and clears it', async () => {
    const gen = await handle.client.callTool({
      name: 'generateKeypair',
      arguments: { persist: false },
    });
    const genJson = extractJsonBlock(extractText(gen).text) as {
      address: string;
      persisted: boolean;
    };
    expect(extractText(gen).isError).toBe(false);
    expect(genJson.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(genJson.persisted).toBe(false);

    const addr = await handle.client.callTool({
      name: 'getWalletAddress',
      arguments: {},
    });
    const addrJson = extractJsonBlock(extractText(addr).text) as {
      loaded: boolean;
      address: string;
    };
    expect(addrJson.loaded).toBe(true);
    expect(addrJson.address).toBe(genJson.address);

    const signed = await handle.client.callTool({
      name: 'signMessage',
      arguments: { message: 'orbitflare-mcp-test' },
    });
    const signedJson = extractJsonBlock(extractText(signed).text) as {
      publicKey: string;
      signatureBase58: string;
      signatureBase64: string;
    };
    expect(extractText(signed).isError).toBe(false);
    expect(signedJson.publicKey).toBe(genJson.address);
    expect(signedJson.signatureBase58.length).toBeGreaterThanOrEqual(86);
    expect(signedJson.signatureBase64.length).toBeGreaterThanOrEqual(86);

    // verify the signature with @noble/ed25519 against the publicKey
    const ed25519 = await import('@noble/ed25519');
    const bs58Mod = await import('bs58');
    const bs58 = bs58Mod.default ?? bs58Mod;
    const sigBytes = bs58.decode(signedJson.signatureBase58);
    const pubBytes = bs58.decode(signedJson.publicKey);
    const msgBytes = new TextEncoder().encode('orbitflare-mcp-test');
    const ok = await ed25519.verifyAsync(sigBytes, msgBytes, pubBytes);
    expect(ok).toBe(true);

    const cleared = await handle.client.callTool({
      name: 'clearKeypair',
      arguments: { removeFromDisk: true },
    });
    expect(extractText(cleared).isError).toBe(false);

    const after = await handle.client.callTool({
      name: 'getWalletAddress',
      arguments: {},
    });
    const afterJson = extractJsonBlock(extractText(after).text) as {
      loaded: boolean;
      address: string | null;
    };
    expect(afterJson.loaded).toBe(false);
    expect(afterJson.address).toBeNull();
  });

  it('signMessage errors when no keypair is loaded', async () => {
    const result = await handle.client.callTool({
      name: 'signMessage',
      arguments: { message: 'hello' },
    });
    const { text, isError } = extractText(result);
    expect(isError).toBe(true);
    expect(text.toLowerCase()).toMatch(/no keypair loaded/);
  });

  it('buildSolTransfer errors when no keypair is loaded', async () => {
    const result = await handle.client.callTool({
      name: 'buildSolTransfer',
      arguments: {
        recipient: '11111111111111111111111111111112',
        amountSol: 0.001,
      },
    });
    const { text, isError } = extractText(result);
    expect(isError).toBe(true);
    expect(text.toLowerCase()).toMatch(/no keypair loaded/);
  });
});

describe.skipIf(SKIP_NETWORK)(
  'OrbitFlare MCP — live RPC roundtrip via ORBITFLARE_RPC_URL',
  () => {
    let handle: ToolHandle;

    beforeAll(async () => {
      handle = await spawnServer({
        ORBITFLARE_RPC_URL: 'https://api.devnet.solana.com',
        ORBITFLARE_API_KEY: 'test',
      });
    });

    afterAll(async () => {
      await handle?.dispose();
    });

    it('getBalance roundtrips against Solana devnet', async () => {
      const result = await handle.client.callTool({
        name: 'getBalance',
        arguments: { address: '11111111111111111111111111111111' },
      });
      const { text, isError } = extractText(result);
      expect(isError).toBe(false);
      const json = extractJsonBlock(text) as {
        address: string;
        lamports: number;
        sol: string;
        slot: number;
      };
      expect(json.address).toBe('11111111111111111111111111111111');
      expect(typeof json.lamports).toBe('number');
      expect(json.slot).toBeGreaterThan(0);
    });

    it('getSlot returns a positive number', async () => {
      const result = await handle.client.callTool({
        name: 'getSlot',
        arguments: { commitment: 'confirmed' },
      });
      const { text, isError } = extractText(result);
      expect(isError).toBe(false);
      const json = extractJsonBlock(text) as { slot: number; commitment: string };
      expect(typeof json.slot).toBe('number');
      expect(json.slot).toBeGreaterThan(0);
      expect(json.commitment).toBe('confirmed');
    });

    it('getEpochInfo returns the documented shape', async () => {
      const result = await handle.client.callTool({
        name: 'getEpochInfo',
        arguments: {},
      });
      const { text, isError } = extractText(result);
      expect(isError).toBe(false);
      const json = extractJsonBlock(text) as {
        epoch: number;
        slotIndex: number;
        slotsInEpoch: number;
        progressPct: number;
      };
      expect(json.epoch).toBeGreaterThanOrEqual(0);
      expect(json.slotIndex).toBeGreaterThanOrEqual(0);
      expect(json.slotsInEpoch).toBeGreaterThan(0);
      expect(json.progressPct).toBeGreaterThanOrEqual(0);
      expect(json.progressPct).toBeLessThanOrEqual(100);
    });

    it('getLatestBlockhash returns a blockhash + lastValidBlockHeight', async () => {
      const result = await handle.client.callTool({
        name: 'getLatestBlockhash',
        arguments: {},
      });
      const { text, isError } = extractText(result);
      expect(isError).toBe(false);
      const json = extractJsonBlock(text) as {
        blockhash: string;
        lastValidBlockHeight: number;
        slot: number;
      };
      expect(json.blockhash.length).toBeGreaterThan(20);
      expect(json.lastValidBlockHeight).toBeGreaterThan(0);
      expect(json.slot).toBeGreaterThan(0);
    });

    it('getMultipleAccounts batches a system + sysvar lookup', async () => {
      const result = await handle.client.callTool({
        name: 'getMultipleAccounts',
        arguments: {
          addresses: [
            '11111111111111111111111111111111',
            'SysvarRent111111111111111111111111111111111',
          ],
        },
      });
      const { text, isError } = extractText(result);
      expect(isError).toBe(false);
      const json = extractJsonBlock(text) as { value: unknown[] };
      expect(Array.isArray(json.value)).toBe(true);
      expect(json.value.length).toBe(2);
    });

    it('getMinimumBalanceForRentExemption returns lamports + sol', async () => {
      const result = await handle.client.callTool({
        name: 'getMinimumBalanceForRentExemption',
        arguments: { dataLength: 100 },
      });
      const { text, isError } = extractText(result);
      expect(isError).toBe(false);
      const json = extractJsonBlock(text) as {
        dataLength: number;
        lamports: number;
      };
      expect(json.dataLength).toBe(100);
      expect(json.lamports).toBeGreaterThan(0);
    });

    it('getNetworkStatus returns version + identity + slot', async () => {
      const result = await handle.client.callTool({
        name: 'getNetworkStatus',
        arguments: {},
      });
      const { text, isError } = extractText(result);
      expect(isError).toBe(false);
      const json = extractJsonBlock(text) as {
        endpoint: string;
        version: unknown;
        identity: unknown;
        slot: unknown;
      };
      expect(json.endpoint).toContain('http');
      expect(json.version).toBeTruthy();
      expect(json.identity).toBeTruthy();
      expect(json.slot).toBeTruthy();
    });

    it('getRecentPrioritizationFees returns percentile breakdown', async () => {
      const result = await handle.client.callTool({
        name: 'getRecentPrioritizationFees',
        arguments: {},
      });
      const { text, isError } = extractText(result);
      expect(isError).toBe(false);
      const json = extractJsonBlock(text) as {
        sampleCount: number;
        microLamportsPerCu: { p50: number; p90: number };
      };
      expect(json.sampleCount).toBeGreaterThanOrEqual(0);
      expect(json.microLamportsPerCu.p50).toBeGreaterThanOrEqual(0);
      expect(json.microLamportsPerCu.p90).toBeGreaterThanOrEqual(
        json.microLamportsPerCu.p50,
      );
    });
  },
);
