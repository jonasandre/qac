import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FileContextProvider } from '../src/context/file-provider.ts';
import { QacError } from '../src/errors.ts';

describe('FileContextProvider', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qac-test-'));
    path = join(dir, 'config.yaml');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('reads empty config when file missing', async () => {
    const p = new FileContextProvider(path);
    expect(await p.read()).toEqual({});
    expect(await p.list()).toEqual([]);
    expect(await p.active()).toBeNull();
  });

  test('create + list + active + resolve', async () => {
    const p = new FileContextProvider(path);
    await p.create('prod', {
      tenant: 'https://acme.qlikcloud.com',
      auth: { type: 'api-key', key: 'qlik_xxx' },
    });

    expect(await p.active()).toBe('prod');
    const list = await p.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'prod', active: true, authType: 'api-key' });

    const ctx = await p.resolve();
    expect(ctx.name).toBe('prod');
    expect(ctx.tenant).toBe('https://acme.qlikcloud.com');
    expect(ctx.credentials).toEqual({ type: 'api-key', apiKey: 'qlik_xxx' });
  });

  test('use + remove', async () => {
    const p = new FileContextProvider(path);
    await p.create('a', { tenant: 'https://a.qlikcloud.com', auth: { type: 'api-key', key: 'k1' } });
    await p.create('b', { tenant: 'https://b.qlikcloud.com', auth: { type: 'api-key', key: 'k2' } });
    expect(await p.active()).toBe('b');

    await p.use('a');
    expect(await p.active()).toBe('a');

    await p.remove('a');
    expect(await p.active()).toBeNull();
    expect(await p.list()).toHaveLength(1);
  });

  test('resolve unknown context throws CONTEXT_NOT_FOUND', async () => {
    const p = new FileContextProvider(path);
    await p.create('prod', { tenant: 'https://acme.qlikcloud.com', auth: { type: 'api-key', key: 'k' } });
    await expect(p.resolve('nope')).rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND' });
  });

  test('resolve with no active throws NO_ACTIVE_CONTEXT', async () => {
    const p = new FileContextProvider(path);
    await expect(p.resolve()).rejects.toMatchObject({ code: 'NO_ACTIVE_CONTEXT' });
  });

  test('$env: reference resolves from env', async () => {
    const env = { MY_KEY: 'resolved-secret' } as NodeJS.ProcessEnv;
    const p = new FileContextProvider(path, env);
    await p.create('prod', {
      tenant: 'https://acme.qlikcloud.com',
      auth: { type: 'api-key', key: '$env:MY_KEY' },
    });
    const ctx = await p.resolve();
    expect(ctx.credentials).toEqual({ type: 'api-key', apiKey: 'resolved-secret' });
  });

  test('$env: reference fails hard when var missing', async () => {
    const env = {} as NodeJS.ProcessEnv;
    const p = new FileContextProvider(path, env);
    await p.create('prod', {
      tenant: 'https://acme.qlikcloud.com',
      auth: { type: 'api-key', key: '$env:MISSING_VAR' },
    });
    await expect(p.resolve()).rejects.toMatchObject({ code: 'ENV_VAR_MISSING' });
  });

  test('oauth-m2m context with mixed env refs', async () => {
    const env = { OAUTH_SECRET: 's3cret' } as NodeJS.ProcessEnv;
    const p = new FileContextProvider(path, env);
    await p.create('m2m', {
      tenant: 'https://acme.qlikcloud.com',
      auth: { type: 'oauth-m2m', clientId: 'client-1', clientSecret: '$env:OAUTH_SECRET' },
    });
    const ctx = await p.resolve();
    expect(ctx.credentials).toEqual({
      type: 'oauth-m2m',
      clientId: 'client-1',
      clientSecret: 's3cret',
    });
  });

  test('makeActive=false preserves existing active', async () => {
    const p = new FileContextProvider(path);
    await p.create('a', { tenant: 'https://a.qlikcloud.com', auth: { type: 'api-key', key: 'k1' } });
    await p.create(
      'b',
      { tenant: 'https://b.qlikcloud.com', auth: { type: 'api-key', key: 'k2' } },
      false,
    );
    expect(await p.active()).toBe('a');
  });

  test.skipIf(process.platform === 'win32')('write creates config with mode 0600', async () => {
    const p = new FileContextProvider(path);
    await p.create('prod', { tenant: 'https://acme.qlikcloud.com', auth: { type: 'api-key', key: 'k' } });
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test.skipIf(process.platform === 'win32')('write repairs loose perms on existing file', async () => {
    const p = new FileContextProvider(path);
    await p.create('prod', { tenant: 'https://acme.qlikcloud.com', auth: { type: 'api-key', key: 'k' } });
    chmodSync(path, 0o644);
    await p.create('staging', { tenant: 'https://stg.qlikcloud.com', auth: { type: 'api-key', key: 'k2' } });
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test.skipIf(process.platform === 'win32')('checkPermissions warns on loose mode', async () => {
    const p = new FileContextProvider(path);
    await p.create('prod', { tenant: 'https://acme.qlikcloud.com', auth: { type: 'api-key', key: 'k' } });
    chmodSync(path, 0o644);
    const result = await p.checkPermissions();
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/loose permissions/);
  });

  test('QacError shape preserved in JSON serialization', async () => {
    const p = new FileContextProvider(path);
    try {
      await p.resolve();
    } catch (err) {
      expect(err).toBeInstanceOf(QacError);
      expect(JSON.parse(JSON.stringify((err as QacError).toJSON())).code).toBe('NO_ACTIVE_CONTEXT');
    }
  });
});
