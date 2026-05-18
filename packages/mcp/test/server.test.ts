import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  type ContextProvider,
  type ContextSummary,
  NoopUsageRecorder,
  type QixAppHandle,
  type QixSessionManager,
  type QlikContext,
} from '@qac/core';
import { buildMcpServer } from '../src/server.ts';

class FakeProvider implements ContextProvider {
  constructor(
    private readonly contexts: Record<string, QlikContext>,
    private readonly activeName: string | null,
  ) {}
  async resolve(name?: string): Promise<QlikContext> {
    const target = name ?? this.activeName;
    if (!target) throw new Error('no active context');
    const ctx = this.contexts[target];
    if (!ctx) throw new Error(`context '${target}' not found`);
    return ctx;
  }
  async list(): Promise<ContextSummary[]> {
    return Object.entries(this.contexts).map(([n, c]) => ({
      name: n,
      tenant: c.tenant,
      authType: c.credentials.type,
      active: n === this.activeName,
    }));
  }
  async active(): Promise<string | null> {
    return this.activeName;
  }
}

class FakeQix implements QixSessionManager {
  constructor(private readonly docFactory: (appId: string) => unknown) {}
  async withApp<T>(
    _ctx: QlikContext,
    appId: string,
    fn: (h: QixAppHandle) => Promise<T>,
  ): Promise<T> {
    return fn({ doc: this.docFactory(appId), appId });
  }
}

async function connectClient(opts: {
  provider: ContextProvider;
  qix: QixSessionManager;
}): Promise<Client> {
  const server = buildMcpServer({
    provider: opts.provider,
    qix: opts.qix,
    usage: new NoopUsageRecorder(),
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('MCP server', () => {
  test('lists all 14 tools (13 core + list_contexts)', async () => {
    const provider = new FakeProvider({}, null);
    const qix = new FakeQix(() => ({}));
    const client = await connectClient({ provider, qix });

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'apply_filters',
        'clear_filters',
        'describe_field',
        'evaluate',
        'get_filters',
        'get_app',
        'list_apps',
        'list_contexts',
        'list_fields',
        'list_master_items',
        'list_sheets',
        'list_spaces',
        'query',
        'search_catalog',
      ].sort(),
    );
    await client.close();
  });

  test('list_contexts returns provider state', async () => {
    const ctx: QlikContext = {
      name: 'prod',
      tenant: 'https://x',
      credentials: { type: 'api-key', apiKey: 'k' },
    };
    const provider = new FakeProvider({ prod: ctx }, 'prod');
    const qix = new FakeQix(() => ({}));
    const client = await connectClient({ provider, qix });

    const res = await client.callTool({ name: 'list_contexts', arguments: {} });
    const payload = JSON.parse((res.content as Array<{ text: string }>)?.[0]?.text ?? '{}');
    expect(payload.active).toBe('prod');
    expect(payload.contexts).toHaveLength(1);
    expect(payload.contexts[0].name).toBe('prod');
    await client.close();
  });

  test('tool with context override resolves correct provider entry', async () => {
    const prod: QlikContext = {
      name: 'prod',
      tenant: 'https://prod',
      credentials: { type: 'api-key', apiKey: 'p' },
    };
    const dev: QlikContext = {
      name: 'dev',
      tenant: 'https://dev',
      credentials: { type: 'api-key', apiKey: 'd' },
    };
    const provider = new FakeProvider({ prod, dev }, 'prod');

    const seenTenants: string[] = [];
    const qix: QixSessionManager = {
      async withApp(callerCtx, _appId, fn) {
        seenTenants.push(callerCtx.tenant);
        return fn({ doc: { getFieldList: async () => [] }, appId: _appId });
      },
    };
    const client = await connectClient({ provider, qix });

    await client.callTool({ name: 'list_fields', arguments: { appId: 'a1' } });
    await client.callTool({ name: 'list_fields', arguments: { appId: 'a1', context: 'dev' } });
    expect(seenTenants).toEqual(['https://prod', 'https://dev']);
    await client.close();
  });

  test('error surfaces as isError + JSON payload', async () => {
    const provider = new FakeProvider({}, null);
    const qix = new FakeQix(() => ({}));
    const client = await connectClient({ provider, qix });

    const res = await client.callTool({ name: 'list_fields', arguments: { appId: 'a1' } });
    expect(res.isError).toBe(true);
    const payload = JSON.parse((res.content as Array<{ text: string }>)?.[0]?.text ?? '{}');
    expect(payload.ok).toBe(false);
    expect(payload.error).toBeDefined();
    await client.close();
  });

  test('query schema and execution accept masterItemId-only objects', async () => {
    const ctx: QlikContext = {
      name: 'prod',
      tenant: 'https://x',
      credentials: { type: 'api-key', apiKey: 'k' },
    };
    const provider = new FakeProvider({ prod: ctx }, 'prod');
    const qix = new FakeQix(() => ({
      getDimensionList: async () => [
        {
          qInfo: { qId: 'D1' },
          qMeta: { title: 'Region' },
          qData: { dim: { qFieldDefs: ['[Region]'], qFieldLabels: ['Region'] } },
        },
      ],
      getMeasureList: async () => [
        {
          qInfo: { qId: 'M1' },
          qMeta: { title: 'Sales' },
          qData: { measure: { qDef: 'Sum([Sales])', qLabel: 'Sales' } },
        },
      ],
      createSessionObject: async () => ({
        getLayout: async () => ({ qHyperCube: { qSize: { qcx: 2, qcy: 0 }, qDataPages: [] } }),
        getHyperCubeData: async () => [],
      }),
    }));
    const client = await connectClient({ provider, qix });

    const tools = await client.listTools();
    const queryTool = tools.tools.find((tool) => tool.name === 'query');
    const dimensionVariants = ((
      queryTool?.inputSchema as {
        properties?: { dimensions?: { items?: { anyOf?: Array<unknown> } } };
      }
    )?.properties?.dimensions?.items?.anyOf ?? []) as Array<{
      type?: string;
      required?: string[];
      properties?: Record<string, unknown>;
    }>;
    const measureVariants = ((
      queryTool?.inputSchema as {
        properties?: { measures?: { items?: { anyOf?: Array<unknown> } } };
      }
    )?.properties?.measures?.items?.anyOf ?? []) as Array<{
      type?: string;
      required?: string[];
      properties?: Record<string, unknown>;
    }>;

    const dimensionObject = dimensionVariants.find((variant) => variant.type === 'object');
    const measureObject = measureVariants.find((variant) => variant.type === 'object');
    expect(dimensionObject?.properties?.masterItemId).toBeDefined();
    expect(dimensionObject?.required ?? []).not.toContain('field');
    expect(measureObject?.properties?.masterItemId).toBeDefined();
    expect(measureObject?.required ?? []).not.toContain('expression');

    const res = await client.callTool({
      name: 'query',
      arguments: {
        appId: 'a1',
        dimensions: [{ masterItemId: 'D1' }],
        measures: [{ masterItemId: 'M1' }],
      },
    });
    expect(res.isError).not.toBe(true);
    const payload = JSON.parse((res.content as Array<{ text: string }>)?.[0]?.text ?? '{}');
    expect(payload.headers).toEqual([
      { name: 'Region', type: 'dimension' },
      { name: 'Sales', type: 'measure' },
    ]);
    await client.close();
  });
});
