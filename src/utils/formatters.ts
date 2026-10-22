import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const LARGE_RESPONSE_BYTES = 48_000;

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  return value;
}

export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, replacer) ?? 'null');
}

export function asText(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function asJson(value: unknown, note?: string): CallToolResult {
  const json = JSON.stringify(value, replacer, 2) ?? 'null';
  if (json.length > LARGE_RESPONSE_BYTES) return tooLargeResponse(value, json.length, note);
  const plain = JSON.parse(json);
  return {
    content: [
      ...(note ? [{ type: 'text' as const, text: note }] : []),
      { type: 'text', text: '```json\n' + json + '\n```' },
    ],
    ...(plain && typeof plain === 'object' && !Array.isArray(plain) ? { structuredContent: plain } : {}),
  };
}

export function asError(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

export function lamportsToSol(lamports: number | bigint | string): string {
  const n = Number(lamports);
  return (n / 1_000_000_000).toFixed(9).replace(/\.?0+$/, '');
}

export function needsConfirmation(action: string, preview: Record<string, unknown>): CallToolResult {
  return asJson(
    { confirmed: false, wouldDo: action, ...preview },
    `Not executed. ${action} Show this to the user, and only if they agree call the tool again with the same arguments plus confirm: true.`,
  );
}

function tooLargeResponse(value: unknown, bytes: number, note?: string): CallToolResult {
  const lines = [
    note ? note + '\n' : '',
    `Response is ${bytes.toLocaleString()} bytes, too large to return inline.`,
    'Summary of the response:',
    '```json',
    JSON.stringify(summarize(value), replacer, 2),
    '```',
    'Narrow the query (smaller limit, filters, dataSlice, or a cursor/page) to receive the full payload.',
  ].filter(Boolean);
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

function summarize(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value)) {
    return {
      __array: true,
      length: value.length,
      sample: value.slice(0, 3).map((v) => summarize(v, depth + 1)),
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
