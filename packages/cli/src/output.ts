import { QacError } from '@qac/core';

export function ok(data: unknown): void {
  process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
}

export function fail(err: unknown): number {
  let payload: { code: string; message: string; details?: Record<string, unknown> };
  let exitCode = 2;

  if (err instanceof QacError) {
    payload = err.toJSON();
    exitCode = exitForCode(err.code);
  } else if (err instanceof Error) {
    payload = { code: 'UNKNOWN', message: err.message };
  } else {
    payload = { code: 'UNKNOWN', message: String(err) };
  }

  process.stderr.write(`${JSON.stringify({ ok: false, error: payload })}\n`);
  return exitCode;
}

function exitForCode(code: string): number {
  if (code === 'INVALID_INPUT') return 1;
  if (
    code === 'NO_ACTIVE_CONTEXT' ||
    code === 'CONTEXT_NOT_FOUND' ||
    code === 'CONTEXT_INVALID' ||
    code === 'CONFIG_NOT_FOUND' ||
    code === 'CONFIG_PARSE_ERROR' ||
    code === 'ENV_VAR_MISSING' ||
    code === 'AUTH_FAILED'
  ) {
    return 3;
  }
  return 2;
}
