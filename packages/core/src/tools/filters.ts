import { z } from 'zod';
import { QacError } from '../errors.ts';
import {
  FILTER_LIMITS,
  type FilterInput,
  type FilterValueInput,
  filterSchema,
} from './filter-schema.ts';
import {
  type NxDataPage,
  type QixDoc,
  type QixFieldValue,
  type QixSelectionSummary,
  type QixStateCounts,
  asDoc,
} from './qix-helpers.ts';
import { defineTool } from './tool.ts';

const fieldListSchema = z
  .array(z.string().min(1).max(FILTER_LIMITS.stringField))
  .max(FILTER_LIMITS.arrayFilters);

export const applyFiltersInput = z.object({
  appId: z.string().min(1).describe('The Qlik app ID (UUID).'),
  filters: z
    .array(filterSchema)
    .min(1)
    .max(FILTER_LIMITS.arrayFilters)
    .describe('Filters to apply to the app selection state.'),
  mode: z
    .enum(['replace', 'add', 'toggle'])
    .optional()
    .default('replace')
    .describe(
      'replace clears/replaces each field selection, add preserves selected values, toggle toggles values.',
    ),
  softLock: z
    .boolean()
    .optional()
    .default(false)
    .describe('Allow changing locked selections where QIX supports soft lock behavior.'),
});

export type ApplyFiltersInput = z.infer<typeof applyFiltersInput>;

export type SelectionValue = {
  value: string;
  numeric?: number;
  state?: string;
};

export type FieldSelection = {
  field: string;
  selected: string;
  selectedCount?: number;
  totalCount?: number;
  values: SelectionValue[];
  truncated: boolean;
  stateCounts?: QixStateCounts;
};

export type ApplyFiltersOutput = {
  mode: ApplyFiltersInput['mode'];
  selections: FieldSelection[];
};

export const clearFiltersInput = z.object({
  appId: z.string().min(1).describe('The Qlik app ID (UUID).'),
  fields: fieldListSchema
    .optional()
    .describe('Specific fields to clear. Omit to clear all selections in the app.'),
});

export type ClearFiltersInput = z.infer<typeof clearFiltersInput>;

export type ClearFiltersOutput = {
  cleared: 'all' | 'fields';
  fields?: string[];
};

export const getFiltersInput = z.object({
  appId: z.string().min(1).describe('The Qlik app ID (UUID).'),
  fields: fieldListSchema
    .optional()
    .describe('Specific fields to inspect. Omit to return fields with active selections.'),
  valueLimit: z
    .number()
    .int()
    .min(1)
    .max(FILTER_LIMITS.arrayFilterValues)
    .optional()
    .default(200)
    .describe('Maximum selected values to return per field. Default 200, max 1000.'),
});

export type GetFiltersInput = z.infer<typeof getFiltersInput>;

export type GetFiltersOutput = {
  selections: FieldSelection[];
};

export const applyFiltersTool = defineTool({
  name: 'apply_filters',
  description:
    'Apply reusable Qlik app selections. Use this before `query` or `evaluate` when the same filters should ' +
    'affect subsequent calls for the same app/user. Use `clear_filters` when done.',
  input: applyFiltersInput,
  async run(ctx, input, deps): Promise<ApplyFiltersOutput> {
    return deps.qix.withApp(ctx, input.appId, async (handle) => {
      const doc = asDoc(handle);
      const selections: FieldSelection[] = [];

      for (const filter of input.filters) {
        assertFilterHasValues(filter);
        const values = uniqueValues(filter.values).map(toQixFieldValue);
        const field = await getFieldOrThrow(doc, filter.field);
        if (!field.selectValues) {
          throw new QacError('QIX_INTERNAL', 'QIX field selection API is unavailable', {
            field: filter.field,
          });
        }

        if (input.mode === 'add') {
          const current = await readFieldSelection(
            doc,
            filter.field,
            FILTER_LIMITS.arrayFilterValues,
          );
          if (current.truncated) {
            throw new QacError(
              'INVALID_INPUT',
              `cannot safely add selections to field '${filter.field}' because existing selections are truncated`,
            );
          }
          const selected = new Set(current.values.map(selectionValueKey));
          const missing = values.filter((v) => !selected.has(qixFieldValueKey(v)));
          if (missing.length > 0) {
            await field.selectValues(missing, true, input.softLock);
          }
        } else {
          await field.selectValues(values, input.mode === 'toggle', input.softLock);
        }

        selections.push(
          await readFieldSelection(doc, filter.field, FILTER_LIMITS.arrayFilterValues),
        );
      }

      return { mode: input.mode, selections };
    });
  },
});

export const clearFiltersTool = defineTool({
  name: 'clear_filters',
  description:
    'Clear Qlik app selections. Omit `fields` to clear all current selections, or pass fields to clear only those selections.',
  input: clearFiltersInput,
  async run(ctx, input, deps): Promise<ClearFiltersOutput> {
    return deps.qix.withApp(ctx, input.appId, async (handle) => {
      const doc = asDoc(handle);
      if (!input.fields?.length) {
        if (!doc.clearAll) {
          throw new QacError('QIX_INTERNAL', 'QIX clear-all selection API is unavailable');
        }
        await doc.clearAll(false);
        return { cleared: 'all' };
      }

      for (const fieldName of input.fields) {
        const field = await getFieldOrThrow(doc, fieldName);
        if (!field.clear) {
          throw new QacError('QIX_INTERNAL', 'QIX field clear API is unavailable', {
            field: fieldName,
          });
        }
        await field.clear();
      }
      return { cleared: 'fields', fields: input.fields };
    });
  },
});

export const getFiltersTool = defineTool({
  name: 'get_filters',
  description:
    'Return current Qlik app selections. Use this to confirm filters before querying or to inspect selected values.',
  input: getFiltersInput,
  async run(ctx, input, deps): Promise<GetFiltersOutput> {
    return deps.qix.withApp(ctx, input.appId, async (handle) => {
      const doc = asDoc(handle);
      const summaries = await readSelectionSummaries(doc);
      const fields = input.fields?.length
        ? input.fields
        : summaries.map((s) => s.qField).filter(Boolean);
      const selections = await Promise.all(
        fields.map(async (field) => {
          if (input.fields?.length) await getFieldOrThrow(doc, field);
          return readFieldSelection(doc, field, input.valueLimit, summaries);
        }),
      );
      return { selections };
    });
  },
});

function assertFilterHasValues(filter: FilterInput): void {
  if (filter.values.length === 0) {
    throw new QacError(
      'INVALID_INPUT',
      `filter for field '${filter.field}' requires at least one value`,
    );
  }
}

async function getFieldOrThrow(doc: QixDoc, fieldName: string) {
  try {
    return await doc.getField(fieldName);
  } catch (err) {
    throw new QacError('FIELD_NOT_FOUND', `field '${fieldName}' not found`, {
      cause: (err as Error).message,
    });
  }
}

async function readSelectionSummaries(doc: QixDoc): Promise<QixSelectionSummary[]> {
  const obj = await doc.createSessionObject({
    qInfo: { qType: 'qac-selections' },
    qSelectionObjectDef: {},
  } as unknown);
  const layout = (await obj.getLayout()) as {
    qSelectionObject?: { qSelections?: QixSelectionSummary[] };
  };
  return layout.qSelectionObject?.qSelections ?? [];
}

async function readFieldSelection(
  doc: QixDoc,
  field: string,
  valueLimit: number,
  summaries?: QixSelectionSummary[],
): Promise<FieldSelection> {
  const summary = summaries?.find((s) => s.qField === field);
  const obj = await doc.createSessionObject({
    qInfo: { qType: 'qac-selection-listbox' },
    qListObjectDef: {
      qDef: {
        qFieldDefs: [field],
        qSortCriterias: [{ qSortByState: 1 }],
      },
      qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 1, qHeight: valueLimit }],
    },
  } as unknown);
  const layout = (await obj.getLayout()) as {
    qListObject?: {
      qDataPages?: NxDataPage[];
      qSize?: { qcy?: number };
      qDimensionInfo?: { qStateCounts?: QixStateCounts };
    };
  };

  const stateCounts = layout.qListObject?.qDimensionInfo?.qStateCounts;
  const selectedCount = summary?.qSelectedCount ?? stateCounts?.qSelected;
  const totalCount = summary?.qTotal ?? layout.qListObject?.qSize?.qcy;
  const values = collectSelectedValues(layout.qListObject?.qDataPages ?? []);

  return {
    field,
    selected: summary?.qSelected ?? values.map((v) => v.value).join(', '),
    selectedCount,
    totalCount,
    values,
    truncated: typeof selectedCount === 'number' ? selectedCount > values.length : false,
    ...(stateCounts ? { stateCounts } : {}),
  };
}

function collectSelectedValues(pages: NxDataPage[]): SelectionValue[] {
  const selectedStates = new Set(['S', 'L', 'XS']);
  const values: SelectionValue[] = [];
  for (const page of pages) {
    for (const row of page.qMatrix) {
      const cell = row[0];
      if (!cell || !cell.qState || !selectedStates.has(cell.qState)) continue;
      const value: SelectionValue = { value: cell.qText ?? '', state: cell.qState };
      if (typeof cell.qNum === 'number' && Number.isFinite(cell.qNum)) {
        value.numeric = cell.qNum;
      }
      values.push(value);
    }
  }
  return values;
}

function uniqueValues(values: FilterValueInput[]): FilterValueInput[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = inputValueKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toQixFieldValue(value: FilterValueInput): QixFieldValue {
  if (typeof value === 'number') {
    return { qText: String(value), qIsNumeric: true, qNumber: value };
  }
  return { qText: value, qIsNumeric: false };
}

function inputValueKey(value: FilterValueInput): string {
  return typeof value === 'number' ? `n:${value}` : `s:${value}`;
}

function qixFieldValueKey(value: QixFieldValue): string {
  return value.qIsNumeric && typeof value.qNumber === 'number'
    ? `n:${value.qNumber}`
    : `s:${value.qText ?? ''}`;
}

function selectionValueKey(value: SelectionValue): string {
  return typeof value.numeric === 'number' ? `n:${value.numeric}` : `s:${value.value}`;
}
