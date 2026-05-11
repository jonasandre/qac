import { z } from 'zod';
import { QacError } from '../errors.ts';
import { defineTool } from './tool.ts';
import { asDoc } from './qix-helpers.ts';

export const evaluateInput = z.object({
  appId: z.string().min(1).describe('The Qlik app ID (UUID).'),
  expression: z
    .string()
    .min(1)
    .max(5000)
    .describe(
      'A single Qlik expression to evaluate against the app, e.g. `Sum([Sales])` or `Count(distinct [Customer])`.',
    ),
});

export type EvaluateInput = z.infer<typeof evaluateInput>;

export type EvaluateOutput = {
  expression: string;
  value: string | number | null;
  type: 'number' | 'string' | 'null';
  numeric?: number;
};

export const evaluateTool = defineTool({
  name: 'evaluate',
  description:
    'Evaluate a single Qlik expression and return its scalar value. Use for KPIs and one-shot calculations ' +
    '(e.g. `Sum([Sales])`, `Count(distinct [Customer])`). For multi-row results, use `query` instead. ' +
    'The result includes both the textual value (e.g. "$1,234.56") and the underlying numeric value when applicable.',
  input: evaluateInput,
  async run(ctx, input, deps): Promise<EvaluateOutput> {
    return deps.qix.withApp(ctx, input.appId, async (handle) => {
      const doc = asDoc(handle);
      try {
        const ex = await doc.evaluateEx(input.expression);
        if (typeof ex.qNum === 'number' && Number.isFinite(ex.qNum) && ex.qIsNumeric) {
          return {
            expression: input.expression,
            value: ex.qNum,
            type: 'number',
          };
        }
        if (typeof ex.qText === 'string' && ex.qText !== '') {
          return {
            expression: input.expression,
            value: ex.qText,
            type: 'string',
            ...(typeof ex.qNum === 'number' && Number.isFinite(ex.qNum) ? { numeric: ex.qNum } : {}),
          };
        }
        return { expression: input.expression, value: null, type: 'null' };
      } catch (err) {
        throw new QacError('EXPRESSION_INVALID', `failed to evaluate expression`, {
          expression: input.expression,
          cause: (err as Error).message,
        });
      }
    });
  },
});
