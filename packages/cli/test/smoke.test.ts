import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '..', 'src', 'index.ts');

async function runCli(args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; exit: number }> {
  const proc = Bun.spawn(['bun', 'run', CLI, ...args], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  return { stdout, stderr, exit };
}

describe('CLI smoke', () => {
  test('--help exits 0', async () => {
    const res = await runCli(['--help']);
    expect(res.exit).toBe(0);
    expect(res.stdout).toContain('Qlik API Companion');
  });

  test('context ls empty config returns []', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qac-cli-'));
    const cfg = join(dir, 'config.yaml');
    try {
      const res = await runCli(['--config', cfg, 'context', 'ls']);
      expect(res.exit).toBe(0);
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.contexts).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('context create + show round-trip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qac-cli-'));
    const cfg = join(dir, 'config.yaml');
    try {
      const create = await runCli([
        '--config',
        cfg,
        'context',
        'create',
        'prod',
        '--tenant',
        'https://acme.qlikcloud.com',
        '--api-key',
        'qlik_xxx_secret',
      ]);
      expect(create.exit).toBe(0);

      const show = await runCli(['--config', cfg, 'context', 'show', 'prod']);
      expect(show.exit).toBe(0);
      const parsed = JSON.parse(show.stdout.trim());
      expect(parsed.data.tenant).toBe('https://acme.qlikcloud.com');
      expect(parsed.data.auth.key).toMatch(/\(masked\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no active context exits 3', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qac-cli-'));
    const cfg = join(dir, 'config.yaml');
    try {
      const res = await runCli(['--config', cfg, 'apps', 'list']);
      expect(res.exit).toBe(3);
      const parsed = JSON.parse(res.stderr.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('NO_ACTIVE_CONTEXT');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('invalid --filter format exits 2', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qac-cli-'));
    const cfg = join(dir, 'config.yaml');
    try {
      await runCli([
        '--config',
        cfg,
        'context',
        'create',
        'prod',
        '--tenant',
        'https://acme.qlikcloud.com',
        '--api-key',
        'k',
      ]);
      const res = await runCli([
        '--config',
        cfg,
        'app',
        'query',
        'app-id',
        '--measure',
        'Sum([X])',
        '--filter',
        'malformed',
      ]);
      expect(res.exit).not.toBe(0);
      expect(res.stderr).toContain('invalid --filter');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
