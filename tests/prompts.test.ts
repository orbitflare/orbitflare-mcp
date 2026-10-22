import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

const REMOVED_TOOLS = [
  'getProfile',
  'listLicenses',
  'listRpcPlans',
  'requestDeviceCode',
  'pollDeviceToken',
  'revokeToken',
  'requestWalletChallenge',
  'verifyWalletSignature',
  'registerWithWallet',
  'listApiKeys',
  'createApiKey',
  'regenerateApiKey',
  'deleteApiKey',
  'addLicenseIp',
  'removeLicenseIp',
  'regenerateLicenseKey',
  'prepareTopUp',
  'confirmTopUp',
  'listInvoices',
  'purchaseRpcPlan',
  'subscribeTransactions',
  'generateKeypair',
  'getWalletAddress',
  'loadKeypair',
  'clearKeypair',
  'signAndSendTransaction',
];

const PROMPTS = [
  'system-prompts/orbitflare/full.md',
  'system-prompts/orbitflare/claude.system.md',
  'system-prompts/orbitflare/openai.developer.md',
];

describe('shipped artifacts', () => {
  it.each([...PROMPTS, 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md'])('file %s exists and is non-trivial', (rel) => {
    const p = resolve(ROOT, rel);
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8').length).toBeGreaterThan(200);
  });

  it.each([...PROMPTS, 'README.md'])('%s only names current tools', (rel) => {
    const text = readFileSync(resolve(ROOT, rel), 'utf8');
    const backticked = [...text.matchAll(/`([a-zA-Z]+)\b[^`]*`/g)].map((m) => m[1]);
    for (const name of REMOVED_TOOLS) expect(backticked, `${rel} mentions ${name}`).not.toContain(name);
  });

  it('package version matches the latest changelog entry', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    const changelog = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8');
    expect(changelog.match(/^## v?(\d+\.\d+\.\d+)/m)?.[1]).toBe(pkg.version);
  });
});
