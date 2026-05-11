export type ToolEvent = {
  tool: string;
  context: string;
  startedAt: number;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
};

export interface UsageRecorder {
  record(event: ToolEvent): void;
}

export class NoopUsageRecorder implements UsageRecorder {
  record(_event: ToolEvent): void {
    // intentional no-op
  }
}

export async function measure<T>(
  recorder: UsageRecorder,
  tool: string,
  context: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    recorder.record({ tool, context, startedAt, durationMs: Date.now() - startedAt, ok: true });
    return result;
  } catch (err) {
    const code = (err as { code?: string }).code;
    recorder.record({
      tool,
      context,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: false,
      errorCode: code,
    });
    throw err;
  }
}
