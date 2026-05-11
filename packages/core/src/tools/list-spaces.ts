import { getSpaces } from '@qlik/api/spaces';
import { z } from 'zod';
import { callQlik, toHostConfig } from '../client.ts';
import { defineTool } from './tool.ts';

export const listSpacesInput = z.object({
  limit: z.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
});

export type ListSpacesInput = z.infer<typeof listSpacesInput>;

export type ListSpacesOutput = {
  spaces: Array<{
    id: string;
    name: string;
    type?: string;
    description?: string;
    ownerId?: string;
  }>;
  nextCursor?: string;
};

export const listSpacesTool = defineTool({
  name: 'list_spaces',
  description:
    'List spaces in the Qlik tenant. Spaces are containers that group apps and other items. ' +
    'Use this to learn which spaces exist, then pass `spaceId` to `list_apps` to filter apps by space.',
  input: listSpacesInput,
  async run(ctx, input): Promise<ListSpacesOutput> {
    const hostConfig = toHostConfig(ctx);
    const res = await callQlik(() =>
      getSpaces(
        {
          limit: input.limit,
          ...(input.cursor ? { next: input.cursor } : {}),
        },
        { hostConfig: hostConfig as never },
      ),
    );

    const data = (res.data ?? {}) as { data?: Array<Record<string, unknown>>; links?: { next?: { href?: string } } };
    const spaces = (data.data ?? []).map((s) => ({
      id: String(s.id ?? ''),
      name: String(s.name ?? ''),
      type: s.type ? String(s.type) : undefined,
      description: s.description ? String(s.description) : undefined,
      ownerId: s.ownerId ? String(s.ownerId) : undefined,
    }));

    return { spaces, ...(extractCursor(data.links?.next?.href) && { nextCursor: extractCursor(data.links?.next?.href) }) };
  },
});

function extractCursor(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, 'https://placeholder').searchParams.get('next') ?? undefined;
  } catch {
    return undefined;
  }
}
