import { Command } from 'commander';
import { FileContextProvider, QacError } from '@qac/core';
import { ok } from '../output.ts';
import { isInteractive, promptSecret, warnLiteralSecret } from '../prompt.ts';
import type { GlobalOpts } from '../resolve-context.ts';

const ENV_REF_PREFIX = '$env:';

function isLiteralSecret(value: string): boolean {
  return !value.startsWith(ENV_REF_PREFIX);
}

function fileProvider(opts: GlobalOpts): FileContextProvider {
  return new FileContextProvider(opts.config, process.env);
}

export function contextCommand(): Command {
  const ctx = new Command('context').description('Manage tenant contexts (auth configurations).');

  ctx
    .command('create <name>')
    .description('Create a new context.')
    .requiredOption('--tenant <url>', 'Qlik tenant URL (e.g. https://acme.qlikcloud.com)')
    .option('--api-key <key>', 'API key (or $env:VAR_NAME reference)')
    .option('--oauth-client-id <id>', 'OAuth2 M2M client id')
    .option('--oauth-client-secret <secret>', 'OAuth2 M2M client secret (or $env:VAR_NAME)')
    .option('--no-activate', "Don't make this the active context")
    .action(async (name: string, cmdOpts: Record<string, unknown>, command) => {
      const globalOpts = command.parent?.parent?.opts() as GlobalOpts;
      const provider = fileProvider(globalOpts);
      const tenant = String(cmdOpts.tenant);
      let apiKey = cmdOpts.apiKey as string | undefined;
      const clientId = cmdOpts.oauthClientId as string | undefined;
      let clientSecret = cmdOpts.oauthClientSecret as string | undefined;
      const activate = cmdOpts.activate !== false;

      if (!apiKey && !clientId && isInteractive()) {
        apiKey = await promptSecret('API key');
      } else if (clientId && !clientSecret && isInteractive()) {
        clientSecret = await promptSecret('OAuth2 client secret');
      }

      if (apiKey) {
        if (isLiteralSecret(apiKey) && isInteractive()) warnLiteralSecret('--api-key');
        await provider.create(
          name,
          { tenant, auth: { type: 'api-key', key: apiKey } },
          activate,
        );
      } else if (clientId && clientSecret) {
        if (isLiteralSecret(clientSecret) && isInteractive()) {
          warnLiteralSecret('--oauth-client-secret');
        }
        await provider.create(
          name,
          { tenant, auth: { type: 'oauth-m2m', clientId, clientSecret } },
          activate,
        );
      } else {
        throw new QacError(
          'INVALID_INPUT',
          'must provide either --api-key or both --oauth-client-id and --oauth-client-secret',
        );
      }
      ok({ created: name, active: activate });
    });

  ctx
    .command('use <name>')
    .description('Switch the active context.')
    .action(async (name: string, _opts, command) => {
      const globalOpts = command.parent?.parent?.opts() as GlobalOpts;
      const provider = fileProvider(globalOpts);
      await provider.use(name);
      ok({ active: name });
    });

  ctx
    .command('ls')
    .description('List all contexts.')
    .action(async (_opts, command) => {
      const globalOpts = command.parent?.parent?.opts() as GlobalOpts;
      const provider = fileProvider(globalOpts);
      ok({ contexts: await provider.list() });
    });

  ctx
    .command('current')
    .description('Print the name of the active context.')
    .action(async (_opts, command) => {
      const globalOpts = command.parent?.parent?.opts() as GlobalOpts;
      const provider = fileProvider(globalOpts);
      ok({ active: await provider.active() });
    });

  ctx
    .command('show <name>')
    .description('Show details of a context (secrets are masked).')
    .action(async (name: string, _opts, command) => {
      const globalOpts = command.parent?.parent?.opts() as GlobalOpts;
      const provider = fileProvider(globalOpts);
      const file = await provider.read();
      const stored = file.contexts?.[name];
      if (!stored) throw new QacError('CONTEXT_NOT_FOUND', `context '${name}' not found`);
      ok({
        name,
        tenant: stored.tenant,
        auth: maskAuth(stored.auth),
        active: file.active === name,
      });
    });

  ctx
    .command('rm <name>')
    .description('Remove a context.')
    .action(async (name: string, _opts, command) => {
      const globalOpts = command.parent?.parent?.opts() as GlobalOpts;
      const provider = fileProvider(globalOpts);
      await provider.remove(name);
      ok({ removed: name });
    });

  return ctx;
}

function maskAuth(auth: { type: string } & Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = { type: auth.type };
  for (const [k, v] of Object.entries(auth)) {
    if (k === 'type') continue;
    if (typeof v === 'string' && v.startsWith('$env:')) {
      masked[k] = v;
    } else if (typeof v === 'string') {
      masked[k] = `${v.slice(0, 4)}…(masked)`;
    } else {
      masked[k] = v;
    }
  }
  return masked;
}
