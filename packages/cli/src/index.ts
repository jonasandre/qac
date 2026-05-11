#!/usr/bin/env bun
import { Command } from 'commander';
import { ZodError } from 'zod';
import { QacError } from '@qac/core';
import { contextCommand } from './commands/context.ts';
import { appsCommand, spacesCommand } from './commands/apps.ts';
import { appCommand } from './commands/app.ts';
import { mcpCommand } from './commands/mcp.ts';
import { fail } from './output.ts';
import pkg from '../package.json' with { type: 'json' };

const program = new Command();

program
  .name('qac')
  .description('Qlik API Companion — CLI + MCP for LLM agents over Qlik Cloud')
  .version(pkg.version)
  .option('--context <name>', 'Override active context for this invocation')
  .option('--config <path>', 'Path to config file (default: ~/.qac/config.yaml)')
  .option('--debug', 'Print debug info to stderr');

program.addCommand(contextCommand());
program.addCommand(appsCommand());
program.addCommand(spacesCommand());
program.addCommand(appCommand());
program.addCommand(mcpCommand());

program.exitOverride();

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof ZodError) {
      const exit = fail(new QacError('INVALID_INPUT', 'input validation failed', { issues: err.issues }));
      process.exit(exit);
    }
    if ((err as { code?: string }).code === 'commander.helpDisplayed') return;
    if ((err as { code?: string }).code === 'commander.version') return;
    if ((err as { code?: string }).code?.startsWith?.('commander.')) {
      const exit = fail(new QacError('INVALID_INPUT', (err as Error).message));
      process.exit(exit);
    }
    const exit = fail(err);
    process.exit(exit);
  }
}

main();
