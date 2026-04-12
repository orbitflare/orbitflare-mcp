import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

describe('shipped artifacts', () => {
  it.each([
    'system-prompts/orbitflare/full.md',
    'system-prompts/orbitflare/claude.system.md',
    'system-prompts/orbitflare/openai.developer.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
  ])('file %s exists and is non-trivial', (rel) => {
    const p = resolve(ROOT, rel);
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p, 'utf8');
    expect(text.length).toBeGreaterThan(200);
  });
});
