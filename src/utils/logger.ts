import type { LogFields, Logger } from '@orbitflare/sdk';

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'];
const threshold = LEVELS.indexOf(process.env.ORBITFLARE_LOG?.toLowerCase() ?? '');

function format(fields?: LogFields): string {
  if (!fields) return '';
  return Object.entries(fields)
    .map(([k, v]) => ` ${k}=${v instanceof Error ? v.message : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('');
}

function writer(level: string) {
  const enabled = threshold !== -1 && LEVELS.indexOf(level) >= threshold;
  return (message: string, fields?: LogFields) => {
    if (enabled) process.stderr.write(`${new Date().toISOString()} ${level.toUpperCase()} ${message}${format(fields)}\n`);
  };
}

export const sdkLogger: Logger = {
  trace: writer('trace'),
  debug: writer('debug'),
  info: writer('info'),
  warn: writer('warn'),
  error: writer('error'),
};
