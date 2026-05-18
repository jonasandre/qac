import {
  applyFiltersTool,
  clearFiltersTool,
  describeFieldTool,
  evaluateTool,
  getFiltersTool,
  listFieldsTool,
  listMasterItemsTool,
  listSheetsTool,
  queryTool,
} from '@qac/core';
import { Command } from 'commander';
import type { GlobalOpts } from '../resolve-context.ts';
import { runTool } from './tool-runner.ts';

export function appCommand(): Command {
  const app = new Command('app').description('Introspect and query a Qlik app (QIX engine).');

  app
    .command('fields <appId>')
    .description('List data model fields.')
    .action(async (appId, _opts, command) => {
      await runTool(listFieldsTool, getGlobal(command), { appId });
    });

  app
    .command('master-items <appId>')
    .description('List master dimensions and measures.')
    .action(async (appId, _opts, command) => {
      await runTool(listMasterItemsTool, getGlobal(command), { appId });
    });

  app
    .command('sheets <appId>')
    .description('List sheets in the app.')
    .action(async (appId, _opts, command) => {
      await runTool(listSheetsTool, getGlobal(command), { appId });
    });

  app
    .command('describe-field <appId> <field>')
    .description('Inspect a field: cardinality + sample values.')
    .option('--sample-size <n>', 'Number of sample values (default 50)', (v) =>
      Number.parseInt(v, 10),
    )
    .action(async (appId, field, opts, command) => {
      await runTool(describeFieldTool, getGlobal(command), {
        appId,
        field,
        sampleSize: opts.sampleSize,
      });
    });

  app
    .command('query <appId>')
    .description('Execute an analytical query (hypercube).')
    .option('--dim <field>', 'Dimension (repeatable)', collect, [])
    .option('--measure <expr>', 'Measure expression (repeatable)', collect, [])
    .option('--filter <field=val,val>', 'Filter field=val[,val] (repeatable)', collect, [])
    .option('--set <expression>', 'Set analysis expression (e.g. {<Year={"2025"}>})')
    .option('--limit <n>', 'Max rows (default 1000, max 10000)', (v) => Number.parseInt(v, 10))
    .option('--offset <n>', 'Row offset (default 0)', (v) => Number.parseInt(v, 10))
    .action(async (appId, opts, command) => {
      await runTool(queryTool, getGlobal(command), {
        appId,
        dimensions: (opts.dim as string[]).map((d) => d),
        measures: (opts.measure as string[]).map((m) => m),
        filters: parseFilters(opts.filter as string[]),
        setExpression: opts.set,
        limit: opts.limit,
        offset: opts.offset,
      });
    });

  const filter = new Command('filter').description(
    'Apply, inspect, and clear Qlik app selections.',
  );

  filter
    .command('apply <appId>')
    .description('Apply reusable filters to the Qlik app selection state.')
    .option('--filter <field=val,val>', 'Filter field=val[,val] (repeatable)', collect, [])
    .option('--field <field>', 'Field to filter when using --value')
    .option('--value <value>', 'Value for --field (repeatable)', collect, [])
    .option('--mode <mode>', 'Selection mode: replace, add, or toggle (default replace)')
    .action(async (appId, opts, command) => {
      await runTool(applyFiltersTool, getGlobal(command), {
        appId,
        filters: parseFilterOptions(opts),
        mode: opts.mode,
      });
    });

  filter
    .command('clear <appId>')
    .description('Clear all selections, or specific fields when --field is provided.')
    .option('--field <field>', 'Field to clear (repeatable)', collect, [])
    .action(async (appId, opts, command) => {
      const fields = opts.field as string[];
      await runTool(clearFiltersTool, getGlobal(command), {
        appId,
        fields: fields.length ? fields : undefined,
      });
    });

  filter
    .command('get <appId>')
    .description('Inspect current Qlik app selections.')
    .option('--field <field>', 'Field to inspect (repeatable)', collect, [])
    .option('--value-limit <n>', 'Max selected values per field (default 200)', (v) =>
      Number.parseInt(v, 10),
    )
    .action(async (appId, opts, command) => {
      const fields = opts.field as string[];
      await runTool(getFiltersTool, getGlobal(command), {
        appId,
        fields: fields.length ? fields : undefined,
        valueLimit: opts.valueLimit,
      });
    });

  app.addCommand(filter);

  app
    .command('eval <appId>')
    .description('Evaluate a single expression and return its scalar value.')
    .requiredOption('--expr <expression>', 'Qlik expression to evaluate')
    .action(async (appId, opts, command) => {
      await runTool(evaluateTool, getGlobal(command), { appId, expression: opts.expr });
    });

  return app;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseFilters(raw: string[]): Array<{ field: string; values: string[] }> | undefined {
  if (!raw.length) return undefined;
  return raw.map((entry) => {
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      throw new Error(`invalid --filter '${entry}', expected field=value[,value]`);
    }

    const field = entry.slice(0, eq);
    const values = entry
      .slice(eq + 1)
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    return { field, values };
  });
}

function parseFilterOptions(opts: {
  filter: string[];
  field?: string;
  value: string[];
}): Array<{ field: string; values: string[] }> {
  if (opts.filter.length) return parseFilters(opts.filter) ?? [];
  if (opts.field && opts.value.length) return [{ field: opts.field, values: opts.value }];
  throw new Error(
    'filter apply requires --filter field=value[,value] or --field with at least one --value',
  );
}

function getGlobal(command: Command): GlobalOpts {
  let current: Command = command;
  while (current.parent) current = current.parent;
  return current.opts() as GlobalOpts;
}
