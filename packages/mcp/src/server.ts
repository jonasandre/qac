import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CompositeContextProvider,
  EphemeralSessionManager,
  NoopUsageRecorder,
  allTools,
  measure,
  QacError,
  type ContextProvider,
  type QlikContext,
  type QixSessionManager,
  type UsageRecorder,
} from '@qac/core';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version;

export type ServerOptions = {
  provider?: ContextProvider;
  qix?: QixSessionManager;
  usage?: UsageRecorder;
};

const contextNameField = z
  .string()
  .optional()
  .describe(
    'Override the active context for this call. Use `list_contexts` to discover available contexts.',
  );

export function buildMcpServer(opts: ServerOptions = {}): McpServer {
  const provider = opts.provider ?? new CompositeContextProvider();
  const qix = opts.qix ?? new EphemeralSessionManager();
  const usage = opts.usage ?? new NoopUsageRecorder();

  const server = new McpServer({ name: 'qac', version: VERSION });

  for (const tool of allTools) {
    const baseShape = (tool.input as z.ZodObject<z.ZodRawShape>).shape;
    const augmentedShape = { ...baseShape, context: contextNameField } as z.ZodRawShape;

    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: augmentedShape },
      async (args: Record<string, unknown>) => {
        try {
          const { context: contextName, ...rest } = args ?? {};
          const ctx = await provider.resolve(
            typeof contextName === 'string' && contextName.length > 0 ? contextName : undefined,
          );
          const parsed = tool.input.parse(rest);
          const runner = tool.run as (
            ctx: QlikContext,
            input: unknown,
            deps: { qix: QixSessionManager; usage: UsageRecorder },
          ) => Promise<unknown>;
          const result = await measure(usage, tool.name, ctx.name, () =>
            runner(ctx, parsed, { qix, usage }),
          );
          return successContent(result);
        } catch (err) {
          return errorContent(err);
        }
      },
    );
  }

  server.registerTool(
    'list_contexts',
    {
      description:
        'List configured tenant contexts (auth profiles) available to this MCP server. ' +
        'Use this to discover which `context` values are accepted by the other tools.',
      inputSchema: {},
    },
    async () => {
      try {
        const contexts = await provider.list();
        const active = await provider.active();
        return successContent({ contexts, active });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  return server;
}

export async function startMcpStdio(opts: ServerOptions = {}): Promise<void> {
  const server = buildMcpServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

type ToolContent = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

function successContent(data: unknown): ToolContent {
  const json = JSON.stringify(data);
  return {
    content: [{ type: 'text', text: json }],
    structuredContent: isObject(data) ? data : { value: data },
  };
}

function errorContent(err: unknown): ToolContent {
  let payload: { code: string; message: string; details?: Record<string, unknown> };
  if (err instanceof QacError) {
    payload = err.toJSON();
  } else if (err instanceof Error) {
    payload = { code: 'UNKNOWN', message: err.message };
  } else {
    payload = { code: 'UNKNOWN', message: String(err) };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: payload }) }],
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Some compilers see these only via wildcard re-exports; keep imports referenced.
type _Unused = QlikContext;
