import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type Network = 'mainnet' | 'devnet';

export type Region =
  | 'mainnet'
  | 'devnet'
  | 'ash'
  | 'ny'
  | 'la'
  | 'slc'
  | 'ams'
  | 'fra'
  | 'lon'
  | 'dub'
  | 'siau'
  | 'tok'
  | 'sgp';

export const REGIONS: Region[] = [
  'mainnet',
  'devnet',
  'ash',
  'ny',
  'la',
  'slc',
  'ams',
  'fra',
  'lon',
  'dub',
  'siau',
  'tok',
  'sgp',
];

interface SessionState {
  apiKey: string | null;
  customerApiKey: string | null;
  bearerToken: string | null;
  network: Network;
  region: Region;
  rpcUrlOverride: string | null;
  walletAddress: string | null;
}

const session: SessionState = {
  apiKey: null,
  customerApiKey: null,
  bearerToken: null,
  network: 'mainnet',
  region: 'mainnet',
  rpcUrlOverride: null,
  walletAddress: null,
};

export const ORBITFLARE_DIR = join(homedir(), '.orbitflare');
export const SESSION_FILE = join(ORBITFLARE_DIR, 'mcp-session.json');
export const KEYPAIR_FILE = join(ORBITFLARE_DIR, 'mcp-keypair.json');

interface PersistedSession {
  bearerToken?: string | null;
  network?: Network;
  region?: Region;
  rpcUrlOverride?: string | null;
}

function ensureDir(): void {
  if (!existsSync(ORBITFLARE_DIR)) {
    mkdirSync(ORBITFLARE_DIR, { recursive: true, mode: 0o700 });
  }
}

function persistSession(): void {
  try {
    ensureDir();
    const data: PersistedSession = {
      bearerToken: session.bearerToken,
      network: session.network,
      region: session.region,
      rpcUrlOverride: session.rpcUrlOverride,
    };
    writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
    try {
      chmodSync(SESSION_FILE, 0o600);
    } catch {
      // best-effort
    }
  } catch {
    // best-effort persistence; continue without crashing
  }
}

function loadPersistedSession(): void {
  try {
    if (!existsSync(SESSION_FILE)) return;
    const raw = readFileSync(SESSION_FILE, 'utf8');
    const data = JSON.parse(raw) as PersistedSession;
    if (data.bearerToken) session.bearerToken = data.bearerToken;
    if (data.network === 'mainnet' || data.network === 'devnet') {
      session.network = data.network;
      session.region = data.network;
    }
    if (data.region && REGIONS.includes(data.region)) session.region = data.region;
    if (data.rpcUrlOverride) session.rpcUrlOverride = data.rpcUrlOverride;
  } catch {
    // ignore corrupt session file
  }
}

export function initFromEnv(): void {
  loadPersistedSession();

  if (process.env.ORBITFLARE_API_KEY) {
    session.apiKey = process.env.ORBITFLARE_API_KEY;
  }
  if (process.env.ORBITFLARE_LICENSE_KEY && !session.apiKey) {
    session.apiKey = process.env.ORBITFLARE_LICENSE_KEY;
  }
  if (process.env.ORBITFLARE_CUSTOMER_API_KEY) {
    session.customerApiKey = process.env.ORBITFLARE_CUSTOMER_API_KEY;
  }
  if (process.env.ORBITFLARE_BEARER_TOKEN) {
    session.bearerToken = process.env.ORBITFLARE_BEARER_TOKEN;
  }
  const net = process.env.ORBITFLARE_NETWORK?.toLowerCase();
  if (net === 'devnet' || net === 'mainnet') {
    session.network = net;
    session.region = net;
  }
  if (process.env.ORBITFLARE_RPC_URL) {
    session.rpcUrlOverride = process.env.ORBITFLARE_RPC_URL;
  }
}

export function getApiKey(): string | null {
  return session.apiKey;
}

export function setApiKey(key: string): void {
  session.apiKey = key;
}

export function getCustomerApiKey(): string | null {
  return session.customerApiKey ?? session.apiKey;
}

export function setCustomerApiKey(key: string): void {
  session.customerApiKey = key;
}

export function getBearerToken(): string | null {
  return session.bearerToken;
}

export function setBearerToken(token: string): void {
  session.bearerToken = token;
  persistSession();
}

export function clearBearerToken(): void {
  session.bearerToken = null;
  persistSession();
}

export function getNetwork(): Network {
  return session.network;
}

export function setNetwork(net: Network): void {
  session.network = net;
  if (session.region === 'mainnet' || session.region === 'devnet') {
    session.region = net;
  }
  persistSession();
}

export function getRegion(): Region {
  return session.region;
}

export function setRegion(region: Region): void {
  session.region = region;
  persistSession();
}

export function getRpcUrl(): string {
  if (session.rpcUrlOverride) return session.rpcUrlOverride;
  return `https://${session.region}.rpc.orbitflare.com`;
}

export function setRpcUrlOverride(url: string | null): void {
  session.rpcUrlOverride = url;
  persistSession();
}

export function getCustomerApiBase(): string {
  return 'https://api.orbitflare.com/customer/v2';
}

export function getWalletAddress(): string | null {
  return session.walletAddress;
}

export function setWalletAddress(address: string | null): void {
  session.walletAddress = address;
}

export function ensureOrbitflareDir(): void {
  ensureDir();
}

export function paths() {
  return { ORBITFLARE_DIR, SESSION_FILE, KEYPAIR_FILE };
}

export class MissingApiKeyError extends Error {
  constructor(kind: 'rpc' | 'customer' = 'rpc') {
    const msg =
      kind === 'rpc'
        ? 'No OrbitFlare RPC license key configured. Set ORBITFLARE_API_KEY env var or call the setApiKey tool.'
        : 'No OrbitFlare Customer API credential configured. Set ORBITFLARE_CUSTOMER_API_KEY env var, sign in with a Bearer token via requestDeviceCode/pollDeviceToken or wallet auth, or call setApiKey with kind="customer".';
    super(msg);
    this.name = 'MissingApiKeyError';
  }
}

export class MissingKeypairError extends Error {
  constructor() {
    super(
      'No wallet keypair loaded. Generate one with generateKeypair, or load one with loadKeypair.',
    );
    this.name = 'MissingKeypairError';
  }
}
