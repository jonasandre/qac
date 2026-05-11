import { describe, expect, test } from 'bun:test';
import { listFieldsTool } from '../src/tools/list-fields.ts';
import { listMasterItemsTool } from '../src/tools/list-master-items.ts';
import { listSheetsTool } from '../src/tools/list-sheets.ts';
import { describeFieldTool } from '../src/tools/describe-field.ts';
import { queryInput, queryTool } from '../src/tools/query.ts';
import { evaluateInput, evaluateTool } from '../src/tools/evaluate.ts';
import { NoopUsageRecorder } from '../src/usage.ts';
import type { QixAppHandle, QixSessionManager } from '../src/session/manager.ts';
import type { QlikContext } from '../src/types.ts';

const ctx: QlikContext = {
  name: 'test',
  tenant: 'https://test.qlikcloud.com',
  credentials: { type: 'api-key', apiKey: 'k' },
};

function makeSession(doc: unknown): QixSessionManager {
  return {
    async withApp<T>(_ctx: QlikContext, appId: string, fn: (h: QixAppHandle) => Promise<T>): Promise<T> {
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
      { name: 'Region', tags: ['$ascii'], isSystem: false, isHidden: undefined, isSemantic: undefined, cardinal: 5, srcTables: undefined },
      { name: 'Sales', tags: ['$numeric'], isSystem: false, isHidden: undefined, isSemantic: undefined, cardinal: 1000, srcTables: undefined },
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
      createSessionObject: async () => ({ getLayout: async () => ({}), getHyperCubeData: async () => [] }),
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

  test('rejects when no dim and no measure', async () => {
    const doc = { createSessionObject: async () => ({ getLayout: async () => ({}), getHyperCubeData: async () => [] }) };
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
    const doc = { createSessionObject: async () => ({ getLayout: async () => ({}), getHyperCubeData: async () => [] }) };
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
