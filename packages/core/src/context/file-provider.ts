import { mkdir, readFile, stat, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as YAML from 'yaml';
import { QacError } from '../errors.ts';
import type { ContextSummary, Credentials, QlikContext } from '../types.ts';
import type { ContextProvider } from './provider.ts';

const DEFAULT_CONFIG_PATH = join(homedir(), '.qac', 'config.yaml');
const ENV_REF_PREFIX = '$env:';

type StoredAuth =
  | { type: 'api-key'; key: string }
  | { type: 'oauth-m2m'; clientId: string; clientSecret: string };

type StoredContext = {
  tenant: string;
  auth: StoredAuth;
};

export type ConfigFile = {
  active?: string;
  contexts?: Record<string, StoredContext>;
};

export class FileContextProvider implements ContextProvider {
  constructor(
    private readonly path: string = DEFAULT_CONFIG_PATH,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async resolve(name?: string): Promise<QlikContext> {
    const file = await this.read();
    const target = name ?? file.active;
    if (!target) {
      throw new QacError('NO_ACTIVE_CONTEXT', 'no active context; create one with `qac context create`');
    }
    const stored = file.contexts?.[target];
    if (!stored) {
      throw new QacError('CONTEXT_NOT_FOUND', `context '${target}' not found`);
    }
    return { name: target, tenant: stored.tenant, credentials: this.materialize(stored.auth, target) };
  }

  async list(): Promise<ContextSummary[]> {
    const file = await this.read();
    const contexts = file.contexts ?? {};
    return Object.entries(contexts).map(([name, c]) => ({
      name,
      tenant: c.tenant,
      authType: c.auth.type,
      active: name === file.active,
    }));
  }

  async active(): Promise<string | null> {
    const file = await this.read();
    return file.active ?? null;
  }

  async create(name: string, ctx: { tenant: string; auth: StoredAuth }, makeActive = true): Promise<void> {
    const file = await this.read();
    file.contexts ??= {};
    file.contexts[name] = ctx;
    if (makeActive || !file.active) file.active = name;
    await this.write(file);
  }

  async use(name: string): Promise<void> {
    const file = await this.read();
    if (!file.contexts?.[name]) {
      throw new QacError('CONTEXT_NOT_FOUND', `context '${name}' not found`);
    }
    file.active = name;
    await this.write(file);
  }

  async remove(name: string): Promise<void> {
    const file = await this.read();
    if (!file.contexts?.[name]) {
      throw new QacError('CONTEXT_NOT_FOUND', `context '${name}' not found`);
    }
    delete file.contexts[name];
    if (file.active === name) delete file.active;
    await this.write(file);
  }

  async read(): Promise<ConfigFile> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = YAML.parse(raw) as ConfigFile | null;
      return parsed ?? {};
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new QacError('CONFIG_PARSE_ERROR', `failed to read ${this.path}`, {
        cause: (err as Error).message,
      });
    }
  }

  async write(file: ConfigFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const yaml = YAML.stringify(file);
    await writeFile(this.path, yaml, 'utf8');
    await chmod(this.path, 0o600).catch(() => {
      // chmod can fail on platforms that don't support it (Windows); ignore.
    });
  }

  async checkPermissions(): Promise<{ ok: boolean; warning?: string }> {
    try {
      const st = await stat(this.path);
      const mode = st.mode & 0o777;
      if (mode & 0o077) {
        return {
          ok: false,
          warning: `${this.path} has loose permissions (mode ${mode.toString(8)}); run \`chmod 600 ${this.path}\``,
        };
      }
      return { ok: true };
    } catch {
      return { ok: true };
    }
  }

  private materialize(auth: StoredAuth, contextName: string): Credentials {
    if (auth.type === 'api-key') {
      return { type: 'api-key', apiKey: this.resolveRef(auth.key, contextName, 'api-key.key') };
    }
    return {
      type: 'oauth-m2m',
      clientId: this.resolveRef(auth.clientId, contextName, 'oauth-m2m.clientId'),
      clientSecret: this.resolveRef(auth.clientSecret, contextName, 'oauth-m2m.clientSecret'),
    };
  }

  private resolveRef(value: string, contextName: string, field: string): string {
    if (!value.startsWith(ENV_REF_PREFIX)) return value;
    const varName = value.slice(ENV_REF_PREFIX.length);
    const resolved = this.env[varName];
    if (!resolved) {
      throw new QacError(
        'ENV_VAR_MISSING',
        `context '${contextName}' field '${field}' references $env:${varName} which is not set`,
        { varName, contextName, field },
      );
    }
    return resolved;
  }
}

export { DEFAULT_CONFIG_PATH };
