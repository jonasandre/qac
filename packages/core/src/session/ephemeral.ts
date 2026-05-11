import { openAppSession } from '@qlik/api/qix';
import { toHostConfig } from '../client.ts';
import { QacError, wrapUnknown } from '../errors.ts';
import type { QlikContext } from '../types.ts';
import type { QixAppHandle, QixSessionManager } from './manager.ts';

const DEFAULT_TIMEOUT_MS = 30_000;

export type EphemeralOptions = {
  timeoutMs?: number;
};

export class EphemeralSessionManager implements QixSessionManager {
  constructor(private readonly opts: EphemeralOptions = {}) {}

  async withApp<T>(
    ctx: QlikContext,
    appId: string,
    fn: (handle: QixAppHandle) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const hostConfig = toHostConfig(ctx);

    // openAppSession returns AppSession with getDoc + close.
    // Cast to any-like surface to avoid leaking @qlik/api internals through QixAppHandle.
    const session = openAppSession({ appId, hostConfig: hostConfig as never });

    try {
      const doc = await withTimeout(session.getDoc(), timeoutMs, 'QIX_TIMEOUT', 'getDoc timed out');
      return await fn({ doc, appId });
    } catch (err) {
      throw normalizeQixError(err, appId);
    } finally {
      try {
        await session.close();
      } catch {
        // best-effort cleanup
      }
    }
  }
}

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  code: 'QIX_TIMEOUT',
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new QacError(code, message, { timeoutMs: ms })), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function normalizeQixError(err: unknown, appId: string): QacError {
  if (err instanceof QacError) return err;
  const msg = (err as Error)?.message ?? String(err);
  if (/not\s*found/i.test(msg) || /1003/.test(msg)) {
    return new QacError('APP_NOT_FOUND', `app '${appId}' not found`, { cause: msg });
  }
  if (/auth/i.test(msg) || /401/.test(msg) || /403/.test(msg)) {
    return new QacError('AUTH_FAILED', `auth failed opening app '${appId}'`, { cause: msg });
  }
  if (/handshake/i.test(msg) || /websocket/i.test(msg)) {
    return new QacError('QIX_HANDSHAKE_FAILED', msg, { appId });
  }
  return wrapUnknown(err, 'QIX_INTERNAL');
}
