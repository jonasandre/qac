import { describe, expect, test } from 'bun:test';
import type { QixAppHandle, QixSessionManager } from '../src/session/manager.ts';
import { describeFieldTool } from '../src/tools/describe-field.ts';
import { evaluateInput, evaluateTool } from '../src/tools/evaluate.ts';
import {
  applyFiltersInput,
  applyFiltersTool,
  clearFiltersTool,
  getFiltersTool,
} from '../src/tools/filters.ts';
import { listFieldsTool } from '../src/tools/list-fields.ts';
import { listMasterItemsTool } from '../src/tools/list-master-items.ts';
import { listSheetsTool } from '../src/tools/list-sheets.ts';
import { queryInput, queryTool } from '../src/tools/query.ts';
import type { QlikContext } from '../src/types.ts';
import { NoopUsageRecorder } from '../src/usage.ts';

const ctx: QlikContext = {
  name: 'test',
  tenant: 'https://test.qlikcloud.com',
  credentials: { type: 'api-key', apiKey: 'k' },
};

function makeSession(doc: unknown): QixSessionManager {
  return {
    async withApp<T>(
      _ctx: QlikContext,
      appId: string,
      fn: (h: QixAppHandle) => Promise<T>,
    ): Promise<T> {
      return fn({ doc, appId });
    },
  };
}

describe('list_fields', () => {
  test('maps qName and qTags', async () => {
    const doc = {
      getFieldList: async () => [
        { qName: 'Region', qTags: ['$ascii'], qIsSystem: false, qCardinal: 5 },
        { qName: 'Sales', qTags: ['$numeric'], qIsSystem: false, qCardinal: 1000 },
      ],
    };
    const out = await listFieldsTool.run(
      ctx,
      { appId: 'a1' },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );
    expect(out.fields).toEqual([
      {
        name: 'Region',
        tags: ['$ascii'],
        isSystem: false,
        isHidden: undefined,
        isSemantic: undefined,
        cardinal: 5,
        srcTables: undefined,
      },
      {
        name: 'Sales',
        tags: ['$numeric'],
        isSystem: false,
        isHidden: undefined,
        isSemantic: undefined,
        cardinal: 1000,
        srcTables: undefined,
      },
    ]);
  });
});

describe('list_master_items', () => {
  test('extracts dimensions and measures from qInfo/qMeta/qData', async () => {
    const doc = {
      getDimensionList: async () => [
        {
          qInfo: { qId: 'D1' },
          qMeta: { title: 'Region', description: 'geo', tags: ['t1'] },
          qData: { dim: { qFieldDefs: ['[Region]'], qFieldLabels: ['Region'], qGrouping: 'N' } },
        },
      ],
      getMeasureList: async () => [
        {
          qInfo: { qId: 'M1' },
          qMeta: { title: 'Sales', description: 'sum sales' },
          qData: { measure: { qDef: 'Sum([Sales])', qLabel: 'Sales' } },
        },
      ],
    };
    const out = await listMasterItemsTool.run(
      ctx,
      { appId: 'a1' },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );
    expect(out.dimensions).toEqual([
      {
        id: 'D1',
        title: 'Region',
        description: 'geo',
        tags: ['t1'],
        grouping: 'N',
        fieldDefs: ['[Region]'],
        fieldLabels: ['Region'],
      },
    ]);
    expect(out.measures).toEqual([
      {
        id: 'M1',
        title: 'Sales',
        description: 'sum sales',
        tags: undefined,
        expression: 'Sum([Sales])',
        label: 'Sales',
        numFormat: undefined,
      },
    ]);
  });
});

describe('list_sheets', () => {
  test('extracts sheets', async () => {
    const doc = {
      getSheetList: async () => [
        { qInfo: { qId: 'S1' }, qMeta: { title: 'Overview' }, qData: { rank: 1 } },
      ],
    };
    const out = await listSheetsTool.run(
      ctx,
      { appId: 'a1' },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );
    expect(out.sheets[0]).toMatchObject({ id: 'S1', title: 'Overview', rank: 1 });
  });
});

describe('describe_field', () => {
  test('returns cardinality + sample values, marks truncated', async () => {
    const doc = {
      getField: async (_name: string) => ({ getCardinal: async () => 100 }),
      createSessionObject: async () => ({
        getLayout: async () => ({
          qListObject: {
            qDataPages: [
              {
                qMatrix: [
                  [{ qText: 'EU', qNum: Number.NaN, qState: 'O' }],
                  [{ qText: '2025', qNum: 2025, qState: 'O' }],
                ],
              },
            ],
          },
        }),
        getHyperCubeData: async () => [],
      }),
    };
    const out = await describeFieldTool.run(
      ctx,
      { appId: 'a1', field: 'Region', sampleSize: 2 },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );
    expect(out.cardinality).toBe(100);
    expect(out.truncated).toBe(true);
    expect(out.sampleValues).toEqual([
      { value: 'EU', state: 'O' },
      { value: '2025', numeric: 2025, state: 'O' },
    ]);
    expect(out.numeric).toBe(true);
  });

  test('FIELD_NOT_FOUND on getField error', async () => {
    const doc = {
      getField: async () => {
        throw new Error('no such field');
      },
      createSessionObject: async () => ({
        getLayout: async () => ({}),
        getHyperCubeData: async () => [],
      }),
    };
    await expect(
      describeFieldTool.run(
        ctx,
        { appId: 'a1', field: 'NoSuch', sampleSize: 5 },
        { qix: makeSession(doc), usage: new NoopUsageRecorder() },
      ),
    ).rejects.toMatchObject({ code: 'FIELD_NOT_FOUND' });
  });
});

describe('filters', () => {
  test('apply_filters selects text and numeric values', async () => {
    const selectedCalls: Array<{ values: unknown[]; toggle?: boolean; softLock?: boolean }> = [];
    const doc = {
      getField: async (_name: string) => ({
        getCardinal: async () => 10,
        selectValues: async (values: unknown[], toggle?: boolean, softLock?: boolean) => {
          selectedCalls.push({ values, toggle, softLock });
          return true;
        },
      }),
      createSessionObject: async (props: unknown) => {
        const p = props as Record<string, unknown>;
        return {
          getLayout: async () => {
            if (p.qSelectionObjectDef) {
              return {
                qSelectionObject: {
                  qSelections: [
                    { qField: 'Region', qSelected: 'EU, 2025', qSelectedCount: 2, qTotal: 10 },
                  ],
                },
              };
            }
            return {
              qListObject: {
                qSize: { qcy: 10 },
                qDimensionInfo: { qStateCounts: { qSelected: 2, qOption: 8 } },
                qDataPages: [
                  {
                    qMatrix: [
                      [{ qText: 'EU', qState: 'S' }],
                      [{ qText: '2025', qNum: 2025, qState: 'S' }],
                      [{ qText: 'US', qState: 'O' }],
                    ],
                  },
                ],
              },
            };
          },
          getHyperCubeData: async () => [],
        };
      },
    };

    const out = await applyFiltersTool.run(
      ctx,
      {
        appId: 'a1',
        filters: [{ field: 'Region', values: ['EU', 2025] }],
        mode: 'replace',
        softLock: false,
      },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );

    expect(selectedCalls).toEqual([
      {
        values: [
          { qText: 'EU', qIsNumeric: false },
          { qText: '2025', qIsNumeric: true, qNumber: 2025 },
        ],
        toggle: false,
        softLock: false,
      },
    ]);
    expect(out.selections[0]).toMatchObject({
      field: 'Region',
      selected: 'EU, 2025',
      selectedCount: 2,
      values: [
        { value: 'EU', state: 'S' },
        { value: '2025', numeric: 2025, state: 'S' },
      ],
    });
  });

  test('apply_filters add mode only toggles missing values', async () => {
    const selectedCalls: Array<{ values: unknown[]; toggle?: boolean }> = [];
    const doc = {
      getField: async () => ({
        getCardinal: async () => 10,
        selectValues: async (values: unknown[], toggle?: boolean) => {
          selectedCalls.push({ values, toggle });
        },
      }),
      createSessionObject: async () => ({
        getLayout: async () => ({
          qListObject: {
            qSize: { qcy: 10 },
            qDimensionInfo: { qStateCounts: { qSelected: 1 } },
            qDataPages: [
              {
                qMatrix: [[{ qText: 'EU', qState: 'S' }], [{ qText: 'US', qState: 'O' }]],
              },
            ],
          },
        }),
        getHyperCubeData: async () => [],
      }),
    };

    await applyFiltersTool.run(
      ctx,
      {
        appId: 'a1',
        filters: [{ field: 'Region', values: ['EU', 'US'] }],
        mode: 'add',
        softLock: false,
      },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );

    expect(selectedCalls).toEqual([{ values: [{ qText: 'US', qIsNumeric: false }], toggle: true }]);
  });

  test('clear_filters clears all selections or selected fields', async () => {
    let clearAllCalled = false;
    const clearedFields: string[] = [];
    const doc = {
      clearAll: async () => {
        clearAllCalled = true;
      },
      getField: async (name: string) => ({
        getCardinal: async () => 10,
        clear: async () => {
          clearedFields.push(name);
        },
      }),
    };

    await clearFiltersTool.run(
      ctx,
      { appId: 'a1' },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );
    await clearFiltersTool.run(
      ctx,
      { appId: 'a1', fields: ['Region', 'Year'] },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );

    expect(clearAllCalled).toBe(true);
    expect(clearedFields).toEqual(['Region', 'Year']);
  });

  test('get_filters returns selected values from current selections', async () => {
    const doc = {
      getField: async () => ({ getCardinal: async () => 10 }),
      createSessionObject: async (props: unknown) => {
        const p = props as Record<string, unknown>;
        return {
          getLayout: async () => {
            if (p.qSelectionObjectDef) {
              return {
                qSelectionObject: {
                  qSelections: [
                    { qField: 'Region', qSelected: 'EU', qSelectedCount: 1, qTotal: 10 },
                  ],
                },
              };
            }
            return {
              qListObject: {
                qSize: { qcy: 10 },
                qDimensionInfo: { qStateCounts: { qSelected: 1, qOption: 9 } },
                qDataPages: [
                  { qMatrix: [[{ qText: 'EU', qState: 'S' }], [{ qText: 'US', qState: 'O' }]] },
                ],
              },
            };
          },
          getHyperCubeData: async () => [],
        };
      },
    };

    const out = await getFiltersTool.run(
      ctx,
      { appId: 'a1', valueLimit: 10 },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );

    expect(out.selections).toEqual([
      {
        field: 'Region',
        selected: 'EU',
        selectedCount: 1,
        totalCount: 10,
        values: [{ value: 'EU', state: 'S' }],
        truncated: false,
        stateCounts: { qSelected: 1, qOption: 9 },
      },
    ]);
  });

  test('apply_filters rejects empty value lists', async () => {
    const doc = {
      getField: async () => ({ getCardinal: async () => 10 }),
      createSessionObject: async () => ({
        getLayout: async () => ({}),
        getHyperCubeData: async () => [],
      }),
    };
    await expect(
      applyFiltersTool.run(
        ctx,
        {
          appId: 'a1',
          filters: [{ field: 'Region', values: [] }],
          mode: 'replace',
          softLock: false,
        },
        { qix: makeSession(doc), usage: new NoopUsageRecorder() },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('apply_filters schema rejects oversize filter values', () => {
    const values = Array.from({ length: 1001 }, (_, i) => `v${i}`);
    const result = applyFiltersInput.safeParse({
      appId: 'a1',
      filters: [{ field: 'F', values }],
    });
    expect(result.success).toBe(false);
  });
});

describe('query', () => {
  test('builds hypercube + returns rows', async () => {
    let capturedProps: Record<string, unknown> | undefined;
    const doc = {
      createSessionObject: async (props: unknown) => {
        capturedProps = props as Record<string, unknown>;
        return {
          getLayout: async () => ({
            qHyperCube: {
              qSize: { qcx: 2, qcy: 2 },
              qDataPages: [
                {
                  qMatrix: [
                    [
                      { qText: 'EU', qNum: Number.NaN },
                      { qText: '100', qNum: 100 },
                    ],
                    [
                      { qText: 'US', qNum: Number.NaN },
                      { qText: '200', qNum: 200 },
                    ],
                  ],
                },
              ],
            },
          }),
          getHyperCubeData: async () => [],
        };
      },
    };
    const out = await queryTool.run(
      ctx,
      {
        appId: 'a1',
        dimensions: ['[Region]'],
        measures: ['Sum([Sales])'],
        limit: 100,
        offset: 0,
      },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );
    expect(out.totalRows).toBe(2);
    expect(out.truncated).toBe(false);
    expect(out.headers).toEqual([
      { name: 'Region', type: 'dimension' },
      { name: 'Sum([Sales])', type: 'measure' },
    ]);
    expect(out.rows).toEqual([
      ['EU', 100],
      ['US', 200],
    ]);
    expect(capturedProps).toBeDefined();
    const cubeDef = (capturedProps?.qHyperCubeDef ?? {}) as Record<string, unknown>;
    expect(cubeDef.qDimensions).toBeDefined();
    expect(cubeDef.qMeasures).toBeDefined();
  });

  test('combines filters into set expression', async () => {
    let capturedDef: string | undefined;
    const doc = {
      createSessionObject: async (props: unknown) => {
        const p = props as { qHyperCubeDef: { qMeasures: Array<{ qDef: { qDef: string } }> } };
        capturedDef = p.qHyperCubeDef.qMeasures[0]?.qDef.qDef;
        return {
          getLayout: async () => ({ qHyperCube: { qSize: { qcx: 1, qcy: 0 }, qDataPages: [] } }),
          getHyperCubeData: async () => [],
        };
      },
    };
    await queryTool.run(
      ctx,
      {
        appId: 'a1',
        dimensions: [],
        measures: ['Sum([Sales])'],
        filters: [{ field: 'Region', values: ['EU', 'US'] }],
        limit: 100,
        offset: 0,
      },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );
    expect(capturedDef).toContain("{<[Region]={'EU','US'}>}");
  });

  test('resolves master dimension by id', async () => {
    let capturedProps: Record<string, unknown> | undefined;
    const doc = {
      getDimensionList: async () => [
        {
          qInfo: { qId: 'D1' },
          qMeta: { title: 'Region' },
          qData: { dim: { qFieldDefs: ['[Region]'], qFieldLabels: ['Region'] } },
        },
      ],
      createSessionObject: async (props: unknown) => {
        capturedProps = props as Record<string, unknown>;
        return {
          getLayout: async () => ({ qHyperCube: { qSize: { qcx: 1, qcy: 0 }, qDataPages: [] } }),
          getHyperCubeData: async () => [],
        };
      },
    };

    const out = await queryTool.run(
      ctx,
      {
        appId: 'a1',
        dimensions: [{ masterItemId: 'D1' }],
        measures: ['Count([Region])'],
        limit: 100,
        offset: 0,
      },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );

    expect(out.headers[0]).toEqual({ name: 'Region', type: 'dimension' });
    const cubeDef = (capturedProps?.qHyperCubeDef ?? {}) as {
      qDimensions?: Array<{ qDef?: { qFieldDefs?: string[]; qFieldLabels?: string[] } }>;
    };
    expect(cubeDef.qDimensions?.[0]?.qDef?.qFieldDefs).toEqual(['[Region]']);
    expect(cubeDef.qDimensions?.[0]?.qDef?.qFieldLabels).toEqual(['Region']);
  });

  test('resolves master measure by id and still applies set analysis', async () => {
    let capturedDef: string | undefined;
    const doc = {
      getMeasureList: async () => [
        {
          qInfo: { qId: 'M1' },
          qMeta: { title: 'Sales' },
          qData: { measure: { qDef: 'Sum([Sales])', qLabel: 'Sales' } },
        },
      ],
      createSessionObject: async (props: unknown) => {
        const p = props as { qHyperCubeDef: { qMeasures: Array<{ qDef: { qDef: string } }> } };
        capturedDef = p.qHyperCubeDef.qMeasures[0]?.qDef.qDef;
        return {
          getLayout: async () => ({ qHyperCube: { qSize: { qcx: 1, qcy: 0 }, qDataPages: [] } }),
          getHyperCubeData: async () => [],
        };
      },
    };

    const out = await queryTool.run(
      ctx,
      {
        appId: 'a1',
        dimensions: [],
        measures: [{ masterItemId: 'M1' }],
        filters: [{ field: 'Region', values: ['EU'] }],
        limit: 100,
        offset: 0,
      },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );

    expect(out.headers[0]).toEqual({ name: 'Sales', type: 'measure' });
    expect(capturedDef).toContain("Sum({<[Region]={'EU'}>} [Sales])");
  });

  test('rejects unknown master item ids', async () => {
    const doc = {
      getMeasureList: async () => [],
      createSessionObject: async () => ({
        getLayout: async () => ({ qHyperCube: { qSize: { qcx: 1, qcy: 0 }, qDataPages: [] } }),
        getHyperCubeData: async () => [],
      }),
    };

    await expect(
      queryTool.run(
        ctx,
        {
          appId: 'a1',
          dimensions: [],
          measures: [{ masterItemId: 'M404' }],
          limit: 100,
          offset: 0,
        },
        { qix: makeSession(doc), usage: new NoopUsageRecorder() },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', details: { masterItemId: 'M404' } });
  });

  test('rejects when no dim and no measure', async () => {
    const doc = {
      createSessionObject: async () => ({
        getLayout: async () => ({}),
        getHyperCubeData: async () => [],
      }),
    };
    await expect(
      queryTool.run(
        ctx,
        { appId: 'a1', dimensions: [], measures: [], limit: 100, offset: 0 },
        { qix: makeSession(doc), usage: new NoopUsageRecorder() },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('schema rejects oversize dimensions array', () => {
    const dims = Array.from({ length: 51 }, (_, i) => `[D${i}]`);
    const result = queryInput.safeParse({ appId: 'a1', dimensions: dims });
    expect(result.success).toBe(false);
  });

  test('schema rejects oversize filter values', () => {
    const values = Array.from({ length: 1001 }, (_, i) => `v${i}`);
    const result = queryInput.safeParse({
      appId: 'a1',
      measures: ['Sum([X])'],
      filters: [{ field: 'F', values }],
    });
    expect(result.success).toBe(false);
  });

  test('schema rejects overlong expression', () => {
    const big = 'x'.repeat(5001);
    const result = queryInput.safeParse({ appId: 'a1', measures: [big] });
    expect(result.success).toBe(false);
  });

  test('schema accepts masterItemId-only dimension and measure objects', () => {
    const result = queryInput.safeParse({
      appId: 'a1',
      dimensions: [{ masterItemId: 'D1' }],
      measures: [{ masterItemId: 'M1' }],
    });
    expect(result.success).toBe(true);
  });

  test('schema rejects title-only master item objects', () => {
    const result = queryInput.safeParse({
      appId: 'a1',
      measures: [{ title: 'Sales' }],
    });
    expect(result.success).toBe(false);
  });

  test('escapes closing bracket in filter field name', async () => {
    let capturedDef: string | undefined;
    const doc = {
      createSessionObject: async (props: unknown) => {
        const p = props as { qHyperCubeDef: { qMeasures: Array<{ qDef: { qDef: string } }> } };
        capturedDef = p.qHyperCubeDef.qMeasures[0]?.qDef.qDef;
        return {
          getLayout: async () => ({ qHyperCube: { qSize: { qcx: 1, qcy: 0 }, qDataPages: [] } }),
          getHyperCubeData: async () => [],
        };
      },
    };
    await queryTool.run(
      ctx,
      {
        appId: 'a1',
        dimensions: [],
        measures: ['Sum([Sales])'],
        filters: [{ field: 'Region]injection', values: ['EU'] }],
        limit: 100,
        offset: 0,
      },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );
    expect(capturedDef).toContain('[Region]]injection]');
  });

  test('rejects malformed raw setExpression', async () => {
    const doc = {
      createSessionObject: async () => ({
        getLayout: async () => ({}),
        getHyperCubeData: async () => [],
      }),
    };
    await expect(
      queryTool.run(
        ctx,
        {
          appId: 'a1',
          dimensions: [],
          measures: ['Sum([Sales])'],
          setExpression: 'arbitrary garbage',
          limit: 100,
          offset: 0,
        },
        { qix: makeSession(doc), usage: new NoopUsageRecorder() },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SET_EXPRESSION' });
  });

  test('accepts well-shaped setExpression', async () => {
    let capturedDef: string | undefined;
    const doc = {
      createSessionObject: async (props: unknown) => {
        const p = props as { qHyperCubeDef: { qMeasures: Array<{ qDef: { qDef: string } }> } };
        capturedDef = p.qHyperCubeDef.qMeasures[0]?.qDef.qDef;
        return {
          getLayout: async () => ({ qHyperCube: { qSize: { qcx: 1, qcy: 0 }, qDataPages: [] } }),
          getHyperCubeData: async () => [],
        };
      },
    };
    await queryTool.run(
      ctx,
      {
        appId: 'a1',
        dimensions: [],
        measures: ['Sum([Sales])'],
        setExpression: '{<Year={2025}>}',
        limit: 100,
        offset: 0,
      },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );
    expect(capturedDef).toContain('{<Year={2025}>}');
  });
});

describe('evaluate', () => {
  test('returns number for numeric result', async () => {
    const doc = {
      evaluateEx: async (_expr: string) => ({ qNum: 42, qText: '42', qIsNumeric: true }),
    };
    const out = await evaluateTool.run(
      ctx,
      { appId: 'a1', expression: 'Sum([Sales])' },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );
    expect(out).toMatchObject({ value: 42, type: 'number' });
  });

  test('returns string for textual result', async () => {
    const doc = {
      evaluateEx: async () => ({ qText: 'EU', qIsNumeric: false }),
    };
    const out = await evaluateTool.run(
      ctx,
      { appId: 'a1', expression: 'Only([Region])' },
      { qix: makeSession(doc), usage: new NoopUsageRecorder() },
    );
    expect(out).toMatchObject({ value: 'EU', type: 'string' });
  });

  test('schema rejects overlong expression', () => {
    const big = 'x'.repeat(5001);
    const result = evaluateInput.safeParse({ appId: 'a1', expression: big });
    expect(result.success).toBe(false);
  });

  test('EXPRESSION_INVALID on engine error', async () => {
    const doc = {
      evaluateEx: async () => {
        throw new Error('bad expression');
      },
    };
    await expect(
      evaluateTool.run(
        ctx,
        { appId: 'a1', expression: '???' },
        { qix: makeSession(doc), usage: new NoopUsageRecorder() },
      ),
    ).rejects.toMatchObject({ code: 'EXPRESSION_INVALID' });
  });
});
