import { Command } from 'commander';
import {
  getAppTool,
  listAppsTool,
  listSpacesTool,
  searchCatalogTool,
} from '@qac/core';
import type { GlobalOpts } from '../resolve-context.ts';
import { runTool } from './tool-runner.ts';

export function appsCommand(): Command {
  const apps = new Command('apps').description('List, get, and search Qlik apps (REST).');

  apps
    .command('list')
    .description('List apps in the tenant.')
    .option('--query <q>', 'Substring filter on name')
    .option('--space <id>', 'Filter by space ID')
    .option('--limit <n>', 'Max results (default 50)', (v) => Number.parseInt(v, 10))
    .option('--cursor <c>', 'Pagination cursor')
    .action(async (opts, command) => {
      await runTool(listAppsTool, getGlobal(command), {
        query: opts.query,
        spaceId: opts.space,
        limit: opts.limit,
        cursor: opts.cursor,
      });
    });

  apps
    .command('get <appId>')
    .description('Fetch metadata for a single app.')
    .action(async (appId, _opts, command) => {
      await runTool(getAppTool, getGlobal(command), { appId });
    });

  apps
    .command('search <term>')
    .description('Search the catalog (apps + other items) by free-text term.')
    .option('--limit <n>', 'Max results (default 25)', (v) => Number.parseInt(v, 10))
    .action(async (term, opts, command) => {
      await runTool(searchCatalogTool, getGlobal(command), { term, limit: opts.limit });
    });

  return apps;
}

export function spacesCommand(): Command {
  const spaces = new Command('spaces').description('List Qlik spaces (REST).');
  spaces
    .command('ls')
    .description('List spaces in the tenant.')
    .option('--limit <n>', 'Max results (default 50)', (v) => Number.parseInt(v, 10))
    .option('--cursor <c>', 'Pagination cursor')
    .action(async (opts, command) => {
      await runTool(listSpacesTool, getGlobal(command), { limit: opts.limit, cursor: opts.cursor });
    });
  return spaces;
}

function getGlobal(command: Command): GlobalOpts {
  return command.parent?.parent?.opts() as GlobalOpts;
}
