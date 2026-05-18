import { z } from 'zod';
import { QacError } from '../errors.ts';
import { FILTER_LIMITS, filterSchema } from './filter-schema.ts';
import { type NxDataPage, asDoc } from './qix-helpers.ts';
import { defineTool } from './tool.ts';

const dimensionObjectSchema = z
  .object({
    field: z
      .string()
      .max(FILTER_LIMITS.stringExpression)
      .optional()
      .describe('Inline field name or expression for the dimension. Not a master item title.'),
    masterItemId: z
      .string()
      .min(1)
      .max(FILTER_LIMITS.stringField)
      .optional()
      .describe('Master dimension ID from `list_master_items`. Use the `id`, not the title/name.'),
    label: z
      .string()
      .max(FILTER_LIMITS.stringField)
      .optional()
      .describe('Display label for the dimension column.'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasField = typeof value.field === 'string' && value.field.length > 0;
    const hasMasterItemId = typeof value.masterItemId === 'string' && value.masterItemId.length > 0;
    if (hasField === hasMasterItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Dimension objects must include exactly one of `field` or `masterItemId`',
        path: hasField ? ['masterItemId'] : ['field'],
      });
    }
  });

const dimensionSchema = z.union([
  z
    .string()
    .max(FILTER_LIMITS.stringExpression)
    .describe('Inline field name (will be bracketed) or expression. Not a master item title.'),
  dimensionObjectSchema,
]);

const measureObjectSchema = z
  .object({
    expression: z
      .string()
      .max(FILTER_LIMITS.stringExpression)
      .optional()
      .describe('Inline aggregation expression, e.g. `Sum([Sales])`. Not a master item title.'),
    masterItemId: z
      .string()
      .min(1)
      .max(FILTER_LIMITS.stringField)
      .optional()
      .describe('Master measure ID from `list_master_items`. Use the `id`, not the title/name.'),
    label: z
      .string()
      .max(FILTER_LIMITS.stringField)
      .optional()
      .describe('Display label for the measure column.'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasExpression = typeof value.expression === 'string' && value.expression.length > 0;
    const hasMasterItemId = typeof value.masterItemId === 'string' && value.masterItemId.length > 0;
    if (hasExpression === hasMasterItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Measure objects must include exactly one of `expression` or `masterItemId`',
        path: hasExpression ? ['masterItemId'] : ['expression'],
      });
    }
  });

const measureSchema = z.union([
  z
    .string()
    .max(FILTER_LIMITS.stringExpression)
    .describe('Inline aggregation expression, e.g. `Sum([Sales])`. Not a master item title.'),
  measureObjectSchema,
]);

const sortSchema = z.object({
  column: z.number().int().min(0).describe('0-based column index in the result.'),
  direction: z.enum(['asc', 'desc']).default('asc'),
});

export const queryInput = z.object({
  appId: z.string().min(1),
  dimensions: z.array(dimensionSchema).max(FILTER_LIMITS.arrayDimensions).default([]),
  measures: z.array(measureSchema).max(FILTER_LIMITS.arrayMeasures).default([]),
  filters: z.array(filterSchema).max(FILTER_LIMITS.arrayFilters).optional(),
  setExpression: z
    .string()
    .max(FILTER_LIMITS.stringExpression)
    .optional()
    .describe(
      'Optional Qlik set analysis modifier applied to all measures, e.g. `{<Year={"2025"}>}`. ' +
        'Use for advanced filtering that cannot be expressed via `filters`.',
    ),
  sort: z.array(sortSchema).max(FILTER_LIMITS.arraySort).optional(),
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
    'When using a master item, send `{masterItemId: "..."}` with the exact `id` returned by `list_master_items`; ' +
    'do not send the title/name. Inline dimensions use strings or `{field, label?}`. Inline measures use ' +
    'strings or `{expression, label?}`. ' +
    'For reusable app selections, call `apply_filters` before `query`. For one-shot filters, use ' +
    '`filters: [{field: "Region", values: ["EU", "US"]}]`. For advanced set analysis, use ' +
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
      const [dimDefs, measDefs] = await Promise.all([
        resolveDimensions(doc, input.dimensions),
        resolveMeasures(doc, input.measures, combinedSet),
      ]);
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
            qDef: {
              qFieldDefs: d.fieldDefs,
              qFieldLabels: d.fieldLabels.length ? d.fieldLabels : [d.label],
              ...(d.grouping ? { qGrouping: d.grouping } : {}),
            },
          })),
          qMeasures: measDefs.map((m) =>
            m.libraryId
              ? { qLibraryId: m.libraryId }
              : { qDef: { qDef: m.expression, qLabel: m.label } },
          ),
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

type NormalizedDimension = {
  fieldDefs: string[];
  fieldLabels: string[];
  label: string;
  grouping?: string;
};
type NormalizedMeasure = { label: string; expression?: string; libraryId?: string };

type QueryDimension = z.infer<typeof dimensionSchema>;
type QueryMeasure = z.infer<typeof measureSchema>;

type MasterDimensionEntry = {
  id: string;
  title?: string;
  fieldDefs?: string[];
  fieldLabels?: string[];
  grouping?: string;
};

type MasterMeasureEntry = {
  id: string;
  title?: string;
  expression?: string;
  label?: string;
};

async function resolveDimensions(doc: ReturnType<typeof asDoc>, dims: QueryDimension[]) {
  const masterMap = hasMasterItemRef(dims) ? await loadMasterDimensions(doc) : undefined;
  return dims.map((d) => normalizeDimension(d, masterMap));
}

async function resolveMeasures(
  doc: ReturnType<typeof asDoc>,
  measures: QueryMeasure[],
  setExpression: string | undefined,
) {
  const masterMap = hasMasterItemRef(measures) ? await loadMasterMeasures(doc) : undefined;
  return measures.map((m) => normalizeMeasure(m, setExpression, masterMap));
}

function normalizeDimension(
  d: QueryDimension,
  masterMap: Map<string, MasterDimensionEntry> | undefined,
): NormalizedDimension {
  if (typeof d === 'string') {
    const label = stripBrackets(d);
    return { fieldDefs: [d], fieldLabels: [label], label };
  }
  if (hasDimensionMasterItemId(d)) {
    const master = masterMap?.get(d.masterItemId);
    if (!master) {
      throw new QacError(
        'INVALID_INPUT',
        `Unknown master dimension '${d.masterItemId}'. Use list_master_items and send its id, not title/name.`,
        { masterItemId: d.masterItemId, itemType: 'dimension' },
      );
    }
    if (!master.fieldDefs?.length) {
      throw new QacError(
        'INVALID_INPUT',
        `Master dimension '${d.masterItemId}' has no field definition`,
        {
          masterItemId: d.masterItemId,
          itemType: 'dimension',
        },
      );
    }
    const primaryFieldDef = master.fieldDefs[0] ?? d.masterItemId;
    const fallbackLabel = master.fieldLabels?.[0] ?? master.title ?? stripBrackets(primaryFieldDef);
    return {
      fieldDefs: master.fieldDefs,
      fieldLabels: master.fieldLabels?.length ? master.fieldLabels : [fallbackLabel],
      label: d.label ?? fallbackLabel,
      ...(master.grouping ? { grouping: master.grouping } : {}),
    };
  }
  if (!hasDimensionField(d)) {
    throw new QacError(
      'INVALID_INPUT',
      'Dimension objects must include exactly one of `field` or `masterItemId`',
    );
  }
  const label = d.label ?? stripBrackets(d.field);
  return { fieldDefs: [d.field], fieldLabels: [label], label };
}

function normalizeMeasure(
  m: QueryMeasure,
  setExpression: string | undefined,
  masterMap: Map<string, MasterMeasureEntry> | undefined,
): NormalizedMeasure {
  const resolved = resolveMeasureReference(m, masterMap, setExpression);
  if (resolved.expression) {
    return {
      expression: applySetExpression(resolved.expression, setExpression),
      label: resolveMeasureLabel(m, resolved.label ?? resolved.expression, masterMap),
    };
  }
  return {
    libraryId: resolved.libraryId,
    label: resolveMeasureLabel(
      m,
      resolved.label ?? resolved.libraryId ?? 'master measure',
      masterMap,
    ),
  };
}

function resolveMeasureReference(
  m: QueryMeasure,
  masterMap: Map<string, MasterMeasureEntry> | undefined,
  setExpression: string | undefined,
) {
  if (typeof m === 'string') return { expression: m, label: m };
  if (hasMeasureMasterItemId(m)) {
    const master = masterMap?.get(m.masterItemId);
    if (!master) {
      throw new QacError(
        'INVALID_INPUT',
        `Unknown master measure '${m.masterItemId}'. Use list_master_items and send its id, not title/name.`,
        { masterItemId: m.masterItemId, itemType: 'measure' },
      );
    }
    if (master.expression) {
      return { expression: master.expression, label: m.label ?? master.label ?? master.title };
    }
    if (setExpression) {
      throw new QacError(
        'INVALID_INPUT',
        `Master measure '${m.masterItemId}' has no inline expression available for query.filters/setExpression. Use apply_filters first or query the master measure without one-shot set analysis.`,
        {
          masterItemId: m.masterItemId,
          itemType: 'measure',
        },
      );
    }
    return { libraryId: m.masterItemId, label: m.label ?? master.label ?? master.title };
  }
  if (!hasMeasureExpression(m)) {
    throw new QacError(
      'INVALID_INPUT',
      'Measure objects must include exactly one of `expression` or `masterItemId`',
    );
  }
  return { expression: m.expression, label: m.label ?? m.expression };
}

function resolveMeasureLabel(
  m: QueryMeasure,
  expression: string,
  masterMap: Map<string, MasterMeasureEntry> | undefined,
): string {
  if (typeof m === 'string') return m;
  if (hasMeasureMasterItemId(m)) {
    const master = masterMap?.get(m.masterItemId);
    return m.label ?? master?.label ?? master?.title ?? expression;
  }
  if (hasMeasureExpression(m)) return m.label ?? m.expression;
  return expression;
}

function hasMasterItemRef(items: Array<QueryDimension | QueryMeasure>): boolean {
  return items.some(
    (item) =>
      typeof item !== 'string' &&
      'masterItemId' in item &&
      typeof item.masterItemId === 'string' &&
      item.masterItemId.length > 0,
  );
}

function hasDimensionMasterItemId(
  value: Exclude<QueryDimension, string>,
): value is Exclude<QueryDimension, string> & { masterItemId: string } {
  return typeof value.masterItemId === 'string' && value.masterItemId.length > 0;
}

function hasDimensionField(
  value: Exclude<QueryDimension, string>,
): value is Exclude<QueryDimension, string> & { field: string } {
  return typeof value.field === 'string' && value.field.length > 0;
}

function hasMeasureMasterItemId(
  value: Exclude<QueryMeasure, string>,
): value is Exclude<QueryMeasure, string> & { masterItemId: string } {
  return typeof value.masterItemId === 'string' && value.masterItemId.length > 0;
}

function hasMeasureExpression(
  value: Exclude<QueryMeasure, string>,
): value is Exclude<QueryMeasure, string> & { expression: string } {
  return typeof value.expression === 'string' && value.expression.length > 0;
}

async function loadMasterDimensions(
  doc: ReturnType<typeof asDoc>,
): Promise<Map<string, MasterDimensionEntry>> {
  const raw = await doc.getDimensionList();
  return new Map(
    raw.map((item) => {
      const entry = readMasterDimension(item);
      return [entry.id, entry] as const;
    }),
  );
}

async function loadMasterMeasures(
  doc: ReturnType<typeof asDoc>,
): Promise<Map<string, MasterMeasureEntry>> {
  const raw = await doc.getMeasureList();
  return new Map(
    raw.map((item) => {
      const entry = readMasterMeasure(item);
      return [entry.id, entry] as const;
    }),
  );
}

function readMasterDimension(item: unknown): MasterDimensionEntry {
  const o = item as Record<string, unknown>;
  const info = (o.qInfo ?? {}) as Record<string, unknown>;
  const meta = (o.qMeta ?? {}) as Record<string, unknown>;
  const data = (o.qData ?? {}) as Record<string, unknown>;
  const dimInfo = (data.dim ?? data.qDim ?? {}) as Record<string, unknown>;
  return {
    id: String(info.qId ?? ''),
    title: meta.title ? String(meta.title) : undefined,
    fieldDefs: Array.isArray(dimInfo.qFieldDefs) ? (dimInfo.qFieldDefs as string[]) : undefined,
    fieldLabels: Array.isArray(dimInfo.qFieldLabels)
      ? (dimInfo.qFieldLabels as string[])
      : undefined,
    grouping: dimInfo.qGrouping ? String(dimInfo.qGrouping) : undefined,
  };
}

function readMasterMeasure(item: unknown): MasterMeasureEntry {
  const o = item as Record<string, unknown>;
  const info = (o.qInfo ?? {}) as Record<string, unknown>;
  const meta = (o.qMeta ?? {}) as Record<string, unknown>;
  const data = (o.qData ?? {}) as Record<string, unknown>;
  const measInfo = (data.measure ?? data.qMeasure ?? {}) as Record<string, unknown>;
  return {
    id: String(info.qId ?? ''),
    title: meta.title ? String(meta.title) : undefined,
    expression: measInfo.qDef ? String(measInfo.qDef) : undefined,
    label: measInfo.qLabel ? String(measInfo.qLabel) : undefined,
  };
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

function buildInterColumnSort(width: number, sort: QueryInput['sort']): number[] | undefined {
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
            if (
              typeof cell.qNum === 'number' &&
              Number.isFinite(cell.qNum) &&
              cell.qText === String(cell.qNum)
            ) {
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
