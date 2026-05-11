import {
  EphemeralSessionManager,
  NoopUsageRecorder,
  measure,
  type ToolDef,
} from '@qac/core';
import type { z } from 'zod';
import { resolveContext, type GlobalOpts } from '../resolve-context.ts';
import { ok } from '../output.ts';

export async function runTool<I extends z.ZodTypeAny, O>(
  tool: ToolDef<I, O>,
  globalOpts: GlobalOpts,
  rawInput: unknown,
): Promise<void> {
  const ctx = await resolveContext(globalOpts);
  const parsed = tool.input.parse(rawInput) as z.infer<I>;
  const qix = new EphemeralSessionManager();
  const usage = new NoopUsageRecorder();
  const result = await measure(usage, tool.name, ctx.name, () =>
    tool.run(ctx, parsed, { qix, usage }),
  );
  ok(result);
}
