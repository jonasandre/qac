import { z } from 'zod';
import { QacError } from '../errors.ts';
import { defineTool } from './tool.ts';
import { asDoc, type NxDataPage } from './qix-helpers.ts';

// All limits sized to comfortably exceed real dashboard queries while
// blocking megabyte-scale payloads / DoS via the MCP/CLI surface.
const LIMITS = {
  arrayDimensions: 50,
  arrayMeasures: 50,
  arrayFilters: 50,
  arrayFilterValues: 1000,
  arraySort: 10,
  stringField: 256,
  stringValue: 256,
  stringExpression: 5000,
} as const;

const dimensionSchema = z.union([
  z.string().max(LIMITS.stringExpression).describe('Field name (will be bracketed) or expression.'),
  z.object({
    field: z
      .string()
      .max(LIMITS.stringExpression)
      .describe('Field name or expression for the dimension.'),
    label: z
      .string()
      .max(LIMITS.stringField)
      .optional()
      .describe('Display label for the dimension column.'),
  }),
]);

const measureSchema = z.union([
  z.string().max(LIMITS.stringExpression).describe('Expression, e.g. `Sum([Sales])`.'),
  z.object({
    expression: z
      .string()
      .max(LIMITS.stringExpression)
      .describe('Aggregation expression, e.g. `Sum([Sales])`.'),
    label: z
      .string()
      .max(LIMITS.stringField)
      .optional()
      .describe('Display label for the measure column.'),
  }),
]);

const filterSchema = z.object({
  field: z.string().max(LIMITS.stringField).describe('Field name to filter on.'),
  values: z
    .array(z.union([z.string().max(LIMITS.stringValue), z.number()]))
    .max(LIMITS.arrayFilterValues)
    .describe('Values to keep.'),
});

const sortSchema = z.object({
  column: z.number().int().min(0).describe('0-based column index in the result.'),
  direction: z.enum(['asc', 'desc']).default('asc'),
});

export const queryInput = z.object({
  appId: z.string().min(1),
  dimensions: z.array(dimensionSchema).max(LIMITS.arrayDimensions).default([]),
  measures: z.array(measureSchema).max(LIMITS.arrayMeasures).default([]),
  filters: z.array(filterSchema).max(LIMITS.arrayFilters).optional(),
  setExpression: z
    .string()
    .max(LIMITS.stringExpression)
    .optional()
    .describe(
      'Optional Qlik set analysis modifier applied to all measures, e.g. `{<Year={"2025"}>}`. ' +
        'Use for advanced filtering that cannot be expressed via `filters`.',
    ),
  sort: z.array(sortSchema).max(LIMITS.arraySort).optional(),
  limit: z.number().int().min(1).max(10000).optional().default(1000),
  offset: z.number().int().min(0).optional().default(0),
});

export type QueryInput = z.infer<typeof queryInput>;

export type QueryRow = Array<string | number | null>;

export type QueryOutput = {
  headers: Array<{ name: string; type: 'dimension' | 'measure' }>;
  rows: QueryRow[];
  totalRows: number;
  truncated: boolean;
};

export const queryTool = defineTool({
  name: 'query',
  description:
    'Execute an analytical query against a Qlik app. Returns a tabular result with the given dimensions ' +
    'and measures. Prefer master items (via `list_master_items`) over inventing your own measure expressions. ' +
    'Filter syntax: `filters: [{field: "Region", values: ["EU", "US"]}]`. For advanced set analysis, use ' +
    '`setExpression` (e.g. `{<Year={"2025"}>}`). Always set a `limit` (default 1000, max 10000); the ' +
    'response includes `totalRows` and `truncated` so you can paginate via `offset` if needed.',
  input: queryInput,
  async run(ctx, input, deps): Promise<QueryOutput> {
    if (input.dimensions.length === 0 && input.measures.length === 0) {
      throw new QacError('INVALID_INPUT', 'query requires at least one dimension or measure');
    }

    return deps.qix.withApp(ctx, input.appId, async (handle) => {
      const doc = asDoc(handle);

      const combinedSet = combineSetExpression(input.filters, input.setExpression);
      const dimDefs = input.dimensions.map((d) => normalizeDimension(d));
      const measDefs = input.measures.map((m) => normalizeMeasure(m, combinedSet));
      const headers = [
        ...dimDefs.map((d) => ({ name: d.label, type: 'dimension' as const })),
        ...measDefs.map((m) => ({ name: m.label, type: 'measure' as const })),
      ];
      const width = headers.length;

      const interColumnSort = buildInterColumnSort(width, input.sort);

      const obj = await doc.createSessionObject({
        qInfo: { qType: 'qac-query' },
        qHyperCubeDef: {
          qDimensions: dimDefs.map((d) => ({
            qDef: { qFieldDefs: [d.field], qFieldLabels: [d.label] },
          })),
          qMeasures: measDefs.map((m) => ({
            qDef: { qDef: m.expression, qLabel: m.label },
          })),
          qSuppressZero: false,
          qSuppressMissing: false,
          qInitialDataFetch: [
            { qTop: input.offset, qLeft: 0, qWidth: width, qHeight: Math.min(input.limit, 1000) },
          ],
          ...(interColumnSort ? { qInterColumnSortOrder: interColumnSort } : {}),
        },
      } as unknown);

      const layout = (await obj.getLayout()) as {
        qHyperCube?: {
          qDataPages?: NxDataPage[];
          qSize?: { qcx: number; qcy: number };
        };
      };
      const cube = layout.qHyperCube ?? {};
      const totalRows = cube.qSize?.qcy ?? 0;
      const initialPages = cube.qDataPages ?? [];

      const rows: QueryRow[] = [];
      collectRows(initialPages, rows);

      // Page through if more requested than initial fetch.
      while (rows.length < Math.min(input.limit, totalRows - input.offset)) {
        const need = Math.min(input.limit - rows.length, 1000);
        if (need <= 0) break;
        const nextPages = await obj.getHyperCubeData('/qHyperCubeDef', [
          { qTop: input.offset + rows.length, qLeft: 0, qWidth: width, qHeight: need },
        ]);
        if (!nextPages.length || !nextPages[0]?.qMatrix.length) break;
        collectRows(nextPages, rows);
      }

      const limited = rows.slice(0, input.limit);
      return {
        headers,
        rows: limited,
        totalRows,
        truncated: totalRows > input.offset + limited.length,
      };
    });
  },
});

type NormalizedDimension = { field: string; label: string };
type NormalizedMeasure = { expression: string; label: string };

function normalizeDimension(d: z.infer<typeof dimensionSchema>): NormalizedDimension {
  if (typeof d === 'string') return { field: d, label: stripBrackets(d) };
  return { field: d.field, label: d.label ?? stripBrackets(d.field) };
}

function normalizeMeasure(
  m: z.infer<typeof measureSchema>,
  setExpression: string | undefined,
): NormalizedMeasure {
  const raw = typeof m === 'string' ? m : m.expression;
  const expression = applySetExpression(raw, setExpression);
  const label = typeof m === 'string' ? m : m.label ?? m.expression;
  return { expression, label };
}

function applySetExpression(expr: string, set: string | undefined): string {
  if (!set) return expr;
  return expr.replace(
    /\b(Sum|Count|Avg|Min|Max|Only|Median|Stdev|RangeSum|Concat|FirstSortedValue|Percentile)\s*\(/gi,
    (match) => `${match}${set} `,
  );
}

function combineSetExpression(
  filters: QueryInput['filters'],
  setExpression: string | undefined,
): string | undefined {
  if (setExpression !== undefined) assertSetExpressionShape(setExpression);

  const filterClauses = (filters ?? []).map((f) => {
    const escaped = f.values
      .map((v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`))
      .join(',');
    return `[${escapeQlikFieldName(f.field)}]={${escaped}}`;
  });

  if (!filterClauses.length && !setExpression) return undefined;
  if (!filterClauses.length) return setExpression;
  const filterSet = `{<${filterClauses.join(',')}>}`;
  if (!setExpression) return filterSet;
  // If user passed setExpression, merge by stripping outer braces and joining clauses.
  const merged = setExpression.replace(/^\{<?/, '').replace(/>?\}$/, '');
  return `{<${[merged, filterClauses.join(',')].filter(Boolean).join(',')}>}`;
}

function assertSetExpressionShape(expr: string): void {
  // Accept Qlik set modifiers: `<...>` optionally wrapped in `{...}`.
  // Rejects free-form text that could splice arbitrary clauses.
  if (!/^\s*\{?\s*<[\s\S]*>\s*\}?\s*$/.test(expr)) {
    throw new QacError(
      'INVALID_SET_EXPRESSION',
      'setExpression must match the Qlik set modifier shape `{<...>}`',
    );
  }
}

function escapeQlikFieldName(name: string): string {
  return name.replace(/\]/g, ']]');
}

function stripBrackets(input: string): string {
  return input.replace(/^\[/, '').replace(/\]$/, '');
}

function buildInterColumnSort(
  width: number,
  sort: QueryInput['sort'],
): number[] | undefined {
  if (!sort || !sort.length) return undefined;
  const base = Array.from({ length: width }, (_, i) => i);
  // Move sorted columns to front.
  const sortedCols = sort.map((s) => s.column).filter((c) => c >= 0 && c < width);
  const seen = new Set(sortedCols);
  const order = [...sortedCols, ...base.filter((i) => !seen.has(i))];
  return order;
}

function collectRows(pages: NxDataPage[], target: QueryRow[]): void {
  for (const page of pages) {
    for (const row of page.qMatrix) {
      target.push(
        row.map((cell): string | number | null => {
          if (cell.qText && cell.qText !== '-') {
            if (typeof cell.qNum === 'number' && Number.isFinite(cell.qNum) && cell.qText === String(cell.qNum)) {
              return cell.qNum;
            }
            return cell.qText;
          }
          if (typeof cell.qNum === 'number' && Number.isFinite(cell.qNum)) {
            return cell.qNum;
          }
          return null;
        }),
      );
    }
  }
}
