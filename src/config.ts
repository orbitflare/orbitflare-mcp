import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { apexUrl, parseApexRegion, type ApexRegion } from '@orbitflare/sdk/apex';

export type Network = 'mainnet' | 'devnet';

export const RPC_REGIONS = ['va', 'ny', 'la', 'slc', 'ams', 'fra', 'lon', 'jp', 'sg'] as const;
export type RpcRegion = (typeof RPC_REGIONS)[number];
export type Region = 'mainnet' | 'devnet' | RpcRegion;
export const REGIONS: Region[] = ['mainnet', 'devnet', ...RPC_REGIONS];

const REGION_ALIASES: Record<string, Region> = { ash: 'va', tok: 'jp', sgp: 'sg' };

export const JETSTREAM_REGIONS = ['ny', 'slc', 'fra', 'ams', 'lon', 'dub', 'sqq', 'jp', 'sgp'] as const;
export type JetstreamRegion = (typeof JETSTREAM_REGIONS)[number];

const RPC_TO_JETSTREAM: Record<Region, JetstreamRegion> = {
  mainnet: 'fra',
  devnet: 'fra',
  va: 'ny',
  ny: 'ny',
  la: 'slc',
  slc: 'slc',
  ams: 'ams',
  fra: 'fra',
  lon: 'lon',
  jp: 'jp',
  sg: 'sgp',
};

const DEFAULT_MAINNET_REGIONS: RpcRegion[] = ['fra', 'ams', 'ny'];

export function parseRegion(value: string | undefined | null): Region | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if ((REGIONS as string[]).includes(v)) return v as Region;
  return REGION_ALIASES[v] ?? null;
}

interface SessionState {
  apiKey: string | null;
  customerApiKey: string | null;
  bearerToken: string | null;
  network: Network;
  region: Region;
  rpcUrlOverride: string | null;
  rpcFallbackUrls: string[];
  jetstreamUrlOverride: string | null;
  walletAddress: string | null;
  apexApiKey: string | null;
  apexRegion: ApexRegion;
  apexUrlOverride: string | null;
  customerApiBase: string;
}

const session: SessionState = {
  apiKey: null,
  customerApiKey: null,
  bearerToken: null,
  network: 'mainnet',
  region: 'mainnet',
  rpcUrlOverride: null,
  rpcFallbackUrls: [],
  jetstreamUrlOverride: null,
  walletAddress: null,
  apexApiKey: null,
  apexRegion: 'global',
  apexUrlOverride: null,
  customerApiBase: 'https://orbitflare.com/api/customer/v2',
};

export const ORBITFLARE_DIR = join(homedir(), '.orbitflare');
export const SESSION_FILE = join(ORBITFLARE_DIR, 'mcp-session.json');
export const KEYPAIR_FILE = join(ORBITFLARE_DIR, 'mcp-keypair.json');

interface PersistedSession {
  bearerToken?: string | null;
  network?: Network;
  region?: string;
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
    // best-effort
  }
}

function loadPersistedSession(): void {
  try {
    if (!existsSync(SESSION_FILE)) return;
    const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as PersistedSession;
    if (data.bearerToken) session.bearerToken = data.bearerToken;
    if (data.network === 'mainnet' || data.network === 'devnet') {
      session.network = data.network;
      session.region = data.network;
    }
    const region = parseRegion(data.region);
    if (region) session.region = region;
    if (data.rpcUrlOverride) session.rpcUrlOverride = data.rpcUrlOverride;
  } catch {
    // ignore corrupt session file
  }
}

function splitUrls(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function initFromEnv(): void {
  loadPersistedSession();
  const env = process.env;

  session.apiKey = env.ORBITFLARE_API_KEY || env.ORBITFLARE_LICENSE_KEY || null;
  if (env.ORBITFLARE_CUSTOMER_API_KEY) session.customerApiKey = env.ORBITFLARE_CUSTOMER_API_KEY;
  if (env.ORBITFLARE_BEARER_TOKEN) session.bearerToken = env.ORBITFLARE_BEARER_TOKEN;

  const net = env.ORBITFLARE_NETWORK?.toLowerCase();
  if (net === 'devnet' || net === 'mainnet') {
    session.network = net;
    session.region = net;
  }
  const region = parseRegion(env.ORBITFLARE_REGION);
  if (region) session.region = region;
  if (env.ORBITFLARE_RPC_URL) session.rpcUrlOverride = env.ORBITFLARE_RPC_URL;
  session.rpcFallbackUrls = splitUrls(env.ORBITFLARE_RPC_FALLBACK_URLS);
  if (env.ORBITFLARE_JETSTREAM_URL) session.jetstreamUrlOverride = env.ORBITFLARE_JETSTREAM_URL;
  if (env.ORBITFLARE_CUSTOMER_API_URL) {
    session.customerApiBase = env.ORBITFLARE_CUSTOMER_API_URL.replace(/\/+$/, '');
  }

  if (env.ORBITFLARE_APEX_API_KEY) session.apexApiKey = env.ORBITFLARE_APEX_API_KEY;
  const apexRegion = parseApexRegion(env.ORBITFLARE_APEX_REGION ?? '');
  if (apexRegion) session.apexRegion = apexRegion;
  if (env.ORBITFLARE_APEX_URL) session.apexUrlOverride = env.ORBITFLARE_APEX_URL;
}

export function getApiKey(): string | null {
  return session.apiKey;
}

export function setApiKey(key: string): void {
  session.apiKey = key;
}

export function getCustomerApiKey(): string | null {
  return session.customerApiKey;
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
  if (session.region === 'mainnet' || session.region === 'devnet') session.region = net;
  persistSession();
}

export function getRegion(): Region {
  return session.region;
}

export function setRegion(region: Region): void {
  session.region = region;
  if (region === 'devnet') session.network = 'devnet';
  else if (session.network === 'devnet') session.network = 'mainnet';
  persistSession();
}

function regionUrl(region: Region): string {
  return `https://${region}.rpc.orbitflare.com`;
}

export function getRpcUrls(): string[] {
  if (session.rpcUrlOverride) return [session.rpcUrlOverride, ...session.rpcFallbackUrls];
  if (session.network === 'devnet' || session.region === 'devnet') {
    return [regionUrl('devnet'), ...session.rpcFallbackUrls];
  }
  const primary: RpcRegion = session.region === 'mainnet' ? DEFAULT_MAINNET_REGIONS[0] : session.region;
  const fallbacks = DEFAULT_MAINNET_REGIONS.filter((r) => r !== primary).map(regionUrl);
  return [regionUrl(primary), ...session.rpcFallbackUrls, ...fallbacks];
}

export function getRpcUrl(): string {
  return getRpcUrls()[0];
}

export function getWsUrl(): string {
  return getRpcUrl().replace(/^http/, 'ws');
}

export function setRpcUrlOverride(url: string | null): void {
  session.rpcUrlOverride = url;
  persistSession();
}

export function getJetstreamUrl(region?: JetstreamRegion): string {
  if (region) return `http://${region}.jetstream.orbitflare.com`;
  if (session.jetstreamUrlOverride) return session.jetstreamUrlOverride;
  if (session.network === 'devnet') {
    throw new Error('Jetstream streams mainnet only and has no devnet endpoint. Switch to mainnet or pass a region explicitly.');
  }
  return `http://${RPC_TO_JETSTREAM[session.region]}.jetstream.orbitflare.com`;
}

export function defaultJetstreamRegion(): JetstreamRegion {
  return RPC_TO_JETSTREAM[session.region];
}

export const STREAM_REGIONS = [...new Set([...JETSTREAM_REGIONS, ...RPC_REGIONS])] as [
  JetstreamRegion | RpcRegion,
  ...(JetstreamRegion | RpcRegion)[],
];

export function toJetstreamRegion(region: JetstreamRegion | RpcRegion): JetstreamRegion {
  return (JETSTREAM_REGIONS as readonly string[]).includes(region) ? (region as JetstreamRegion) : RPC_TO_JETSTREAM[region as RpcRegion];
}

export function getYellowstoneUrl(region?: JetstreamRegion | RpcRegion): string {
  const host = (r: string) => `http://${r}.rpc.orbitflare.com:10000`;
  if (!region) {
    if (session.network === 'devnet' || session.region === 'devnet') return host('devnet');
    return host(session.region === 'mainnet' ? DEFAULT_MAINNET_REGIONS[0] : session.region);
  }
  if ((RPC_REGIONS as readonly string[]).includes(region)) return host(region);
  if (region === 'sgp') return host('sg');
  throw new Error(`Yellowstone gRPC has no ${region} endpoint. Use one of ${RPC_REGIONS.join(', ')}.`);
}

export function getCustomerApiBase(): string {
  return session.customerApiBase;
}

export function getApexApiKey(): string | null {
  return session.apexApiKey;
}

export function setApexApiKey(key: string): void {
  session.apexApiKey = key;
}

export function getApexRegion(): ApexRegion {
  return session.apexRegion;
}

export function getApexUrl(region?: ApexRegion): string {
  if (region) return apexUrl(region);
  return session.apexUrlOverride ?? apexUrl(session.apexRegion);
}

export function hasApexUrlOverride(): boolean {
  return session.apexUrlOverride !== null;
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
  constructor(kind: 'rpc' | 'customer' | 'apex' = 'rpc') {
    const msg =
      kind === 'rpc'
        ? 'No OrbitFlare RPC license key configured. Set ORBITFLARE_API_KEY env var or call setApiKey.'
        : kind === 'apex'
          ? 'No OrbitFlare Apex API key configured. Create one under Dashboard > Apex, then set ORBITFLARE_APEX_API_KEY env var or call setApiKey with kind="apex".'
          : 'No OrbitFlare Customer API credential configured. Set ORBITFLARE_CUSTOMER_API_KEY env var, sign in with the auth tool (device code or wallet), or call setApiKey with kind="customer".';
    super(msg);
    this.name = 'MissingApiKeyError';
  }
}

export class MissingKeypairError extends Error {
  constructor() {
    super('No wallet keypair loaded. Use the wallet tool with action "generate" or "load" first.');
    this.name = 'MissingKeypairError';
  }
}
