import { z } from 'zod';
import { QacError } from '../errors.ts';
import { defineTool } from './tool.ts';
import { asDoc, type NxDataPage } from './qix-helpers.ts';

export const describeFieldInput = z.object({
  appId: z.string().min(1).describe('The Qlik app ID (UUID).'),
  field: z.string().min(1).describe('Field name as listed by `list_fields`.'),
  sampleSize: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe('How many distinct sample values to return. Default 50, max 500.'),
});

export type DescribeFieldInput = z.infer<typeof describeFieldInput>;

export type DescribeFieldOutput = {
  field: string;
  cardinality: number;
  sampleValues: Array<{ value: string; numeric?: number; state?: string }>;
  truncated: boolean;
  numeric?: boolean;
};

export const describeFieldTool = defineTool({
  name: 'describe_field',
  description:
    'Inspect a single Qlik field: total distinct value count (cardinality), and a sample of distinct values. ' +
    'Use this BEFORE writing filters or expressions involving the field — it shows how the values are spelled, ' +
    'whether they are numeric, and gives a rough sense of size. Defaults to 50 samples.',
  input: describeFieldInput,
  async run(ctx, input, deps): Promise<DescribeFieldOutput> {
    return deps.qix.withApp(ctx, input.appId, async (handle) => {
      const doc = asDoc(handle);
      let field: Awaited<ReturnType<typeof doc.getField>>;
      try {
        field = await doc.getField(input.field);
      } catch (err) {
        throw new QacError('FIELD_NOT_FOUND', `field '${input.field}' not found`, {
          cause: (err as Error).message,
        });
      }

      const cardinality = await field.getCardinal();
      const sampleSize = input.sampleSize;

      const obj = await doc.createSessionObject({
        qInfo: { qType: 'qac-listbox' },
        qListObjectDef: {
          qDef: { qFieldDefs: [input.field] },
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 1, qHeight: sampleSize }],
        },
      } as unknown);

      const layout = (await obj.getLayout()) as {
        qListObject?: { qDataPages?: NxDataPage[] };
      };
      const pages = layout.qListObject?.qDataPages ?? [];
      const matrix = pages[0]?.qMatrix ?? [];

      let anyNumeric = false;
      const sampleValues = matrix.map((row) => {
        const cell = row[0];
        if (!cell) return { value: '' };
        const result: { value: string; numeric?: number; state?: string } = {
          value: cell.qText ?? '',
        };
        if (typeof cell.qNum === 'number' && Number.isFinite(cell.qNum)) {
          result.numeric = cell.qNum;
          anyNumeric = true;
        }
        if (cell.qState) result.state = cell.qState;
        return result;
      });

      return {
        field: input.field,
        cardinality,
        sampleValues,
        truncated: cardinality > sampleSize,
        ...(anyNumeric ? { numeric: true } : {}),
      };
    });
  },
});
