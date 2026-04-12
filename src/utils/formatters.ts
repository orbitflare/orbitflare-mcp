import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const LARGE_RESPONSE_BYTES = 32_000;

export function asText(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}

export function asJson(value: unknown, note?: string): CallToolResult {
  const json = JSON.stringify(value, null, 2);
  if (json.length > LARGE_RESPONSE_BYTES) {
    return tooLargeResponse(value, json.length, note);
  }
  return {
    content: [
      ...(note ? ([{ type: 'text', text: note }] as const) : []),
      { type: 'text', text: '```json\n' + json + '\n```' },
    ],
  };
}

export function asError(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

export function lamportsToSol(lamports: number | bigint | string): string {
  const n = typeof lamports === 'bigint' ? Number(lamports) : Number(lamports);
  return (n / 1_000_000_000).toFixed(9).replace(/\.?0+$/, '');
}

function tooLargeResponse(
  value: unknown,
  bytes: number,
  note?: string,
): CallToolResult {
  const summary = summarize(value);
  const lines = [
    note ? note + '\n' : '',
    `Response is ${bytes.toLocaleString()} bytes — too large to return inline.`,
    'Summary of the response:',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    'Narrow your query (smaller slot range, fewer signatures, more specific filters) to receive the full payload.',
  ].filter(Boolean);
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

function summarize(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value)) {
    return {
      __array: true,
      length: value.length,
      sample: value
        .slice(0, 3)
        .map((v) => summarize(v, depth + 1)),
    };
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let i = 0;
    for (const [k, v] of Object.entries(value)) {
      if (i++ >= 12) {
        out.__moreKeys = '...';
        break;
      }
      out[k] = summarize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 200) {
    return value.slice(0, 200) + '... [+' + (value.length - 200) + ' chars]';
  }
  return value;
}
