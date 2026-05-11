import type { ContextSummary, QlikContext } from '../types.ts';
import { EnvContextProvider, hasEnvContext } from './env-provider.ts';
import { FileContextProvider } from './file-provider.ts';
import type { ContextProvider } from './provider.ts';

export type CompositeOptions = {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
};

export class CompositeContextProvider implements ContextProvider {
  readonly file: FileContextProvider;
  readonly envProvider: EnvContextProvider;
  private readonly env: NodeJS.ProcessEnv;

  constructor(opts: CompositeOptions = {}) {
    this.env = opts.env ?? process.env;
    this.file = new FileContextProvider(opts.configPath, this.env);
    this.envProvider = new EnvContextProvider(this.env);
  }

  async resolve(name?: string): Promise<QlikContext> {
    if (name) return this.file.resolve(name);
    const envOverride = this.env.QAC_CONTEXT;
    if (envOverride) return this.file.resolve(envOverride);
    if (hasEnvContext(this.env)) return this.envProvider.resolve();
    return this.file.resolve();
  }

  async list(): Promise<ContextSummary[]> {
    const fileList = await this.file.list();
    const envList = await this.envProvider.list();
    return [...fileList, ...envList];
  }

  async active(): Promise<string | null> {
    if (this.env.QAC_CONTEXT) return this.env.QAC_CONTEXT;
    if (hasEnvContext(this.env)) return this.envProvider.active();
    return this.file.active();
  }
}
