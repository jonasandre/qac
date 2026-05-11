import { describe, expect, test } from 'bun:test';
import { toHostConfig } from '../src/client.ts';
import type { QlikContext } from '../src/types.ts';

describe('toHostConfig', () => {
  test('builds apiKey host config', () => {
    const ctx: QlikContext = {
      name: 'prod',
      tenant: 'https://acme.qlikcloud.com',
      credentials: { type: 'api-key', apiKey: 'qk_xxx' },
    };
    expect(toHostConfig(ctx)).toEqual({
      authType: 'apiKey',
      host: 'https://acme.qlikcloud.com',
      apiKey: 'qk_xxx',
    });
  });

  test('builds oauth2 host config', () => {
    const ctx: QlikContext = {
      name: 'm2m',
      tenant: 'https://acme.qlikcloud.com',
      credentials: { type: 'oauth-m2m', clientId: 'c', clientSecret: 's' },
    };
    expect(toHostConfig(ctx)).toEqual({
      authType: 'oauth2',
      host: 'https://acme.qlikcloud.com',
      clientId: 'c',
      clientSecret: 's',
      noCache: true,
    });
  });

  test('normalizes host: adds https + strips trailing slash', () => {
    const ctx: QlikContext = {
      name: 'p',
      tenant: 'acme.qlikcloud.com/',
      credentials: { type: 'api-key', apiKey: 'k' },
    };
    expect(toHostConfig(ctx).host).toBe('https://acme.qlikcloud.com');
  });

  test('allows http for localhost', () => {
    const ctx: QlikContext = {
      name: 'local',
      tenant: 'http://localhost:9999',
      credentials: { type: 'api-key', apiKey: 'k' },
    };
    expect(toHostConfig(ctx).host).toBe('http://localhost:9999');
  });

  test('allows http for 127.0.0.1', () => {
    const ctx: QlikContext = {
      name: 'local',
      tenant: 'http://127.0.0.1:9999',
      credentials: { type: 'api-key', apiKey: 'k' },
    };
    expect(toHostConfig(ctx).host).toBe('http://127.0.0.1:9999');
  });

  test('rejects http for non-loopback tenant', () => {
    const ctx: QlikContext = {
      name: 'prod',
      tenant: 'http://acme.qlikcloud.com',
      credentials: { type: 'api-key', apiKey: 'k' },
    };
    expect(() => toHostConfig(ctx)).toThrow(/http:\/\/ is only allowed for localhost/);
  });
});
