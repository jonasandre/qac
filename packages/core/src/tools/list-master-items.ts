import { z } from 'zod';
import { defineTool } from './tool.ts';
import { asDoc } from './qix-helpers.ts';

export const listMasterItemsInput = z.object({
  appId: z.string().min(1).describe('The Qlik app ID (UUID).'),
});

export type ListMasterItemsInput = z.infer<typeof listMasterItemsInput>;

export type MasterDimension = {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  grouping?: string;
  fieldDefs?: string[];
  fieldLabels?: string[];
};

export type MasterMeasure = {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  expression: string;
  label?: string;
  numFormat?: string;
};

export type ListMasterItemsOutput = {
  dimensions: MasterDimension[];
  measures: MasterMeasure[];
};

export const listMasterItemsTool = defineTool({
  name: 'list_master_items',
  description:
    'List master dimensions and master measures defined in a Qlik app. These are the analyst-curated, ' +
    'reusable building blocks for queries. ALWAYS prefer master measures over inventing your own expressions ' +
    'in `query` and `evaluate`, since master items are validated and consistent with how humans analyze the app. ' +
    'Returns ids, titles, descriptions, tags, and the underlying field/expression definitions.',
  input: listMasterItemsInput,
  async run(ctx, input, deps): Promise<ListMasterItemsOutput> {
    return deps.qix.withApp(ctx, input.appId, async (handle) => {
      const doc = asDoc(handle);
      const [dimsRaw, measRaw] = await Promise.all([doc.getDimensionList(), doc.getMeasureList()]);

      const dimensions = dimsRaw.map((item): MasterDimension => {
        const o = item as Record<string, unknown>;
        const info = (o.qInfo ?? {}) as Record<string, unknown>;
        const meta = (o.qMeta ?? {}) as Record<string, unknown>;
        const data = (o.qData ?? {}) as Record<string, unknown>;
        const dimInfo = (data.dim ?? data.qDim ?? {}) as Record<string, unknown>;
        const fieldDefs = Array.isArray(dimInfo.qFieldDefs)
          ? (dimInfo.qFieldDefs as string[])
          : undefined;
        const fieldLabels = Array.isArray(dimInfo.qFieldLabels)
          ? (dimInfo.qFieldLabels as string[])
          : undefined;
        return {
          id: String(info.qId ?? ''),
          title: String(meta.title ?? data.title ?? ''),
          description: meta.description ? String(meta.description) : undefined,
          tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : undefined,
          grouping: dimInfo.qGrouping ? String(dimInfo.qGrouping) : undefined,
          ...(fieldDefs ? { fieldDefs } : {}),
          ...(fieldLabels ? { fieldLabels } : {}),
        };
      });

      const measures = measRaw.map((item): MasterMeasure => {
        const o = item as Record<string, unknown>;
        const info = (o.qInfo ?? {}) as Record<string, unknown>;
        const meta = (o.qMeta ?? {}) as Record<string, unknown>;
        const data = (o.qData ?? {}) as Record<string, unknown>;
        const measInfo = (data.measure ?? data.qMeasure ?? {}) as Record<string, unknown>;
        return {
          id: String(info.qId ?? ''),
          title: String(meta.title ?? data.title ?? ''),
          description: meta.description ? String(meta.description) : undefined,
          tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : undefined,
          expression: String(measInfo.qDef ?? ''),
          label: measInfo.qLabel ? String(measInfo.qLabel) : undefined,
          numFormat: measInfo.qNumFormat ? JSON.stringify(measInfo.qNumFormat) : undefined,
        };
      });

      return { dimensions, measures };
    });
  },
});
