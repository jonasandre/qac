import { z } from 'zod';
import { defineTool } from './tool.ts';
import { asDoc } from './qix-helpers.ts';

export const listFieldsInput = z.object({
  appId: z.string().min(1).describe('The Qlik app ID (UUID).'),
});

export type ListFieldsInput = z.infer<typeof listFieldsInput>;

export type FieldInfo = {
  name: string;
  tags?: string[];
  isSystem?: boolean;
  isHidden?: boolean;
  isSemantic?: boolean;
  cardinal?: number;
  srcTables?: string[];
};

export type ListFieldsOutput = {
  fields: FieldInfo[];
};

export const listFieldsTool = defineTool({
  name: 'list_fields',
  description:
    'List data model fields available in a Qlik app. Use this to discover what data columns exist before ' +
    'writing queries or expressions. Returns name, tags, system/hidden flags, cardinality, and source tables. ' +
    'Prefer this before `query` so you know which field names are valid.',
  input: listFieldsInput,
  async run(ctx, input, deps): Promise<ListFieldsOutput> {
    return deps.qix.withApp(ctx, input.appId, async (handle) => {
      const doc = asDoc(handle);
      const raw = await doc.getFieldList();
      const fields: FieldInfo[] = raw.map((item) => {
        const f = item as Record<string, unknown>;
        return {
          name: String(f.qName ?? ''),
          tags: Array.isArray(f.qTags) ? (f.qTags as string[]) : undefined,
          isSystem: typeof f.qIsSystem === 'boolean' ? (f.qIsSystem as boolean) : undefined,
          isHidden: typeof f.qIsHidden === 'boolean' ? (f.qIsHidden as boolean) : undefined,
          isSemantic: typeof f.qIsSemantic === 'boolean' ? (f.qIsSemantic as boolean) : undefined,
          cardinal: typeof f.qCardinal === 'number' ? (f.qCardinal as number) : undefined,
          srcTables: Array.isArray(f.qSrcTables) ? (f.qSrcTables as string[]) : undefined,
        };
      });
      return { fields };
    });
  },
});
