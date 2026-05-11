import { z } from 'zod';
import { defineTool } from './tool.ts';
import { asDoc } from './qix-helpers.ts';

export const listSheetsInput = z.object({
  appId: z.string().min(1).describe('The Qlik app ID (UUID).'),
});

export type ListSheetsInput = z.infer<typeof listSheetsInput>;

export type SheetInfo = {
  id: string;
  title: string;
  description?: string;
  rank?: number;
  thumbnail?: string;
};

export type ListSheetsOutput = {
  sheets: SheetInfo[];
};

export const listSheetsTool = defineTool({
  name: 'list_sheets',
  description:
    'List sheets in a Qlik app. Sheets are the visual canvases analysts have arranged in the app and ' +
    'represent the human-curated narrative of the data. Useful when the LLM needs context about how analysts ' +
    'have organized the app, or to choose master items relevant to a specific sheet.',
  input: listSheetsInput,
  async run(ctx, input, deps): Promise<ListSheetsOutput> {
    return deps.qix.withApp(ctx, input.appId, async (handle) => {
      const doc = asDoc(handle);
      const raw = await doc.getSheetList();
      const sheets = raw.map((item): SheetInfo => {
        const o = item as Record<string, unknown>;
        const info = (o.qInfo ?? {}) as Record<string, unknown>;
        const meta = (o.qMeta ?? {}) as Record<string, unknown>;
        const data = (o.qData ?? {}) as Record<string, unknown>;
        return {
          id: String(info.qId ?? ''),
          title: String(meta.title ?? data.title ?? ''),
          description: meta.description ? String(meta.description) : undefined,
          rank: typeof data.rank === 'number' ? (data.rank as number) : undefined,
          thumbnail: data.thumbnail ? String((data.thumbnail as { qUrl?: string }).qUrl ?? '') : undefined,
        };
      });
      return { sheets };
    });
  },
});
