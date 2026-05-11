import { QacError, wrapUnknown } from './errors.ts';
import type { QlikContext } from './types.ts';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

type ApiKeyHostConfig = {
  authType: 'apiKey';
  host: string;
  apiKey: string;
};

type Oauth2HostConfig = {
  authType: 'oauth2';
  host: string;
  clientId: string;
  clientSecret: string;
  noCache?: boolean;
};

export type QlikHostConfig = ApiKeyHostConfig | Oauth2HostConfig;

export function toHostConfig(ctx: QlikContext): QlikHostConfig {
  const host = normalizeHost(ctx.tenant);
  if (ctx.credentials.type === 'api-key') {
    return { authType: 'apiKey', host, apiKey: ctx.credentials.apiKey };
  }
  return {
    authType: 'oauth2',
    host,
    clientId: ctx.credentials.clientId,
    clientSecret: ctx.credentials.clientSecret,
    noCache: true,
  };
}

function normalizeHost(input: string): string {
  let h = input.trim();
  if (!/^https?:\/\//i.test(h)) h = `https://${h}`;
  if (/^http:\/\//i.test(h)) {
    let parsed: URL;
    try {
      parsed = new URL(h);
    } catch {
      throw new QacError('INSECURE_TENANT_URL', `invalid tenant URL: ${input}`);
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (!LOOPBACK_HOSTS.has(hostname.toLowerCase())) {
      throw new QacError(
        'INSECURE_TENANT_URL',
        `http:// is only allowed for localhost; use https:// for ${parsed.hostname}`,
      );
    }
  }
  return h.replace(/\/+$/, '');
}

export async function callQlik<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw wrapUnknown(err, 'REST_ERROR');
  }
}
