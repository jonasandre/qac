import { describe, expect, test } from 'bun:test';
import { CompositeContextProvider } from '../src/context/composite-provider.ts';
import { EnvContextProvider, hasEnvContext, readEnvContext } from '../src/context/env-provider.ts';
import { FileContextProvider } from '../src/context/file-provider.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('EnvContextProvider', () => {
  test('hasEnvContext detects api-key path', () => {
    expect(hasEnvContext({ QAC_TENANT_URL: 'https://x', QAC_API_KEY: 'k' })).toBe(true);
  });

  test('hasEnvContext detects oauth pair', () => {
    expect(
      hasEnvContext({
        QAC_TENANT_URL: 'https://x',
        QAC_OAUTH_CLIENT_ID: 'c',
        QAC_OAUTH_CLIENT_SECRET: 's',
      }),
    ).toBe(true);
  });

  test('hasEnvContext rejects partial config', () => {
    expect(hasEnvContext({ QAC_TENANT_URL: 'https://x' })).toBe(false);
    expect(hasEnvContext({ QAC_API_KEY: 'k' })).toBe(false);
    expect(hasEnvContext({ QAC_OAUTH_CLIENT_ID: 'c' })).toBe(false);
  });

  test('readEnvContext builds api-key context', () => {
    const ctx = readEnvContext({ QAC_TENANT_URL: 'https://x', QAC_API_KEY: 'k' });
    expect(ctx.credentials).toEqual({ type: 'api-key', apiKey: 'k' });
    expect(ctx.tenant).toBe('https://x');
  });

  test('readEnvContext builds oauth context', () => {
    const ctx = readEnvContext({
      QAC_TENANT_URL: 'https://x',
      QAC_OAUTH_CLIENT_ID: 'c',
      QAC_OAUTH_CLIENT_SECRET: 's',
    });
    expect(ctx.credentials).toEqual({ type: 'oauth-m2m', clientId: 'c', clientSecret: 's' });
  });

  test('provider.list returns single ephemeral when env set', async () => {
    const p = new EnvContextProvider({ QAC_TENANT_URL: 'https://x', QAC_API_KEY: 'k' });
    const list = await p.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.active).toBe(true);
  });
});

describe('CompositeContextProvider precedence', () => {
  test('explicit name wins over everything', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qac-comp-'));
    const path = join(dir, 'config.yaml');
    const file = new FileContextProvider(path);
    await file.create('prod', { tenant: 'https://prod', auth: { type: 'api-key', key: 'p' } });
    await file.create('dev', { tenant: 'https://dev', auth: { type: 'api-key', key: 'd' } });

    const comp = new CompositeContextProvider({
      configPath: path,
      env: { QAC_CONTEXT: 'prod', QAC_TENANT_URL: 'https://env', QAC_API_KEY: 'e' },
    });
    const ctx = await comp.resolve('dev');
    expect(ctx.name).toBe('dev');
    rmSync(dir, { recursive: true, force: true });
  });

  test('QAC_CONTEXT env overrides active context', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qac-comp-'));
    const path = join(dir, 'config.yaml');
    const file = new FileContextProvider(path);
    await file.create('prod', { tenant: 'https://prod', auth: { type: 'api-key', key: 'p' } });
    await file.create('dev', { tenant: 'https://dev', auth: { type: 'api-key', key: 'd' } });
    await file.use('prod');

    const comp = new CompositeContextProvider({ configPath: path, env: { QAC_CONTEXT: 'dev' } });
    const ctx = await comp.resolve();
    expect(ctx.name).toBe('dev');
    rmSync(dir, { recursive: true, force: true });
  });

  test('env vars create ephemeral context when no QAC_CONTEXT', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qac-comp-'));
    const path = join(dir, 'config.yaml');
    const comp = new CompositeContextProvider({
      configPath: path,
      env: { QAC_TENANT_URL: 'https://env', QAC_API_KEY: 'e' },
    });
    const ctx = await comp.resolve();
    expect(ctx.tenant).toBe('https://env');
    rmSync(dir, { recursive: true, force: true });
  });

  test('falls back to file active when no env signals', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qac-comp-'));
    const path = join(dir, 'config.yaml');
    const file = new FileContextProvider(path);
    await file.create('prod', { tenant: 'https://prod', auth: { type: 'api-key', key: 'p' } });

    const comp = new CompositeContextProvider({ configPath: path, env: {} });
    const ctx = await comp.resolve();
    expect(ctx.name).toBe('prod');
    rmSync(dir, { recursive: true, force: true });
  });
});
