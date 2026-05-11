import { describe, expect, test } from 'bun:test';
import { measure, NoopUsageRecorder, type ToolEvent, type UsageRecorder } from '../src/usage.ts';
import { QacError } from '../src/errors.ts';

class CollectRecorder implements UsageRecorder {
  events: ToolEvent[] = [];
  record(e: ToolEvent): void {
    this.events.push(e);
  }
}

describe('measure', () => {
  test('records success', async () => {
    const rec = new CollectRecorder();
    const result = await measure(rec, 'list_apps', 'prod', async () => 'ok');
    expect(result).toBe('ok');
    expect(rec.events).toHaveLength(1);
    expect(rec.events[0]).toMatchObject({ tool: 'list_apps', context: 'prod', ok: true });
  });

  test('records failure with code', async () => {
    const rec = new CollectRecorder();
    await expect(
      measure(rec, 'query', 'prod', async () => {
        throw new QacError('APP_NOT_FOUND', 'no');
      }),
    ).rejects.toBeDefined();
    expect(rec.events[0]).toMatchObject({ tool: 'query', context: 'prod', ok: false, errorCode: 'APP_NOT_FOUND' });
  });

  test('NoopUsageRecorder does not throw', () => {
    expect(() => new NoopUsageRecorder().record({} as ToolEvent)).not.toThrow();
  });
});
