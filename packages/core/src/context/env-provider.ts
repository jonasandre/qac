import { QacError } from '../errors.ts';
import type { ContextSummary, Credentials, QlikContext } from '../types.ts';
import type { ContextProvider } from './provider.ts';

const ENV_TENANT = 'QAC_TENANT_URL';
const ENV_API_KEY = 'QAC_API_KEY';
const ENV_OAUTH_CLIENT_ID = 'QAC_OAUTH_CLIENT_ID';
const ENV_OAUTH_CLIENT_SECRET = 'QAC_OAUTH_CLIENT_SECRET';

const EPHEMERAL_NAME = '__env__';

export function hasEnvContext(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env[ENV_TENANT]) return false;
  if (env[ENV_API_KEY]) return true;
  if (env[ENV_OAUTH_CLIENT_ID] && env[ENV_OAUTH_CLIENT_SECRET]) return true;
  return false;
}

export function readEnvContext(env: NodeJS.ProcessEnv = process.env): QlikContext {
  const tenant = env[ENV_TENANT];
  if (!tenant) {
    throw new QacError('ENV_VAR_MISSING', `${ENV_TENANT} not set`);
  }

  let credentials: Credentials;
  if (env[ENV_API_KEY]) {
    credentials = { type: 'api-key', apiKey: env[ENV_API_KEY] };
  } else if (env[ENV_OAUTH_CLIENT_ID] && env[ENV_OAUTH_CLIENT_SECRET]) {
    credentials = {
      type: 'oauth-m2m',
      clientId: env[ENV_OAUTH_CLIENT_ID],
      clientSecret: env[ENV_OAUTH_CLIENT_SECRET],
    };
  } else {
    throw new QacError(
      'ENV_VAR_MISSING',
      `set ${ENV_API_KEY} or both ${ENV_OAUTH_CLIENT_ID}+${ENV_OAUTH_CLIENT_SECRET}`,
    );
  }

  return { name: EPHEMERAL_NAME, tenant, credentials };
}

export class EnvContextProvider implements ContextProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async resolve(): Promise<QlikContext> {
    return readEnvContext(this.env);
  }

  async list(): Promise<ContextSummary[]> {
    if (!hasEnvContext(this.env)) return [];
    const ctx = readEnvContext(this.env);
    return [{ name: ctx.name, tenant: ctx.tenant, authType: ctx.credentials.type, active: true }];
  }

  async active(): Promise<string | null> {
    return hasEnvContext(this.env) ? EPHEMERAL_NAME : null;
  }
}
