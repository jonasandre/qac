import { wrapUnknown } from './errors.ts';
import type { QlikContext } from './types.ts';

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
  return h.replace(/\/+$/, '');
}

export async function callQlik<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw wrapUnknown(err, 'REST_ERROR');
  }
}
