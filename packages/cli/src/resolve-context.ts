import { CompositeContextProvider, type QlikContext } from '@qac/core';

export type GlobalOpts = {
  context?: string;
  config?: string;
  debug?: boolean;
};

export function buildProvider(opts: GlobalOpts): CompositeContextProvider {
  return new CompositeContextProvider({
    configPath: opts.config,
    env: process.env,
  });
}

export async function resolveContext(opts: GlobalOpts): Promise<QlikContext> {
  const provider = buildProvider(opts);
  return provider.resolve(opts.context);
}
