import type { z } from 'zod';
import type { QixSessionManager } from '../session/manager.ts';
import type { UsageRecorder } from '../usage.ts';
import type { QlikContext } from '../types.ts';

export type ToolDeps = {
  qix: QixSessionManager;
  usage: UsageRecorder;
};

export type ToolDef<Input extends z.ZodTypeAny, Output> = {
  name: string;
  description: string;
  input: Input;
  run(ctx: QlikContext, input: z.infer<Input>, deps: ToolDeps): Promise<Output>;
};

export function defineTool<I extends z.ZodTypeAny, O>(def: ToolDef<I, O>): ToolDef<I, O> {
  return def;
}
