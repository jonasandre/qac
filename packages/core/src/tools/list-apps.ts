import { getItems } from '@qlik/api/items';
import { z } from 'zod';
import { callQlik, toHostConfig } from '../client.ts';
import { defineTool } from './tool.ts';

export const listAppsInput = z.object({
  query: z.string().optional().describe('Case-insensitive substring filter on app name or description.'),
  spaceId: z.string().optional().describe('Filter by space ID. Omit to list across all spaces.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe('Max apps to return (1-100). Default 50.'),
  cursor: z.string().optional().describe('Pagination cursor from a previous response.'),
});

export type ListAppsInput = z.infer<typeof listAppsInput>;

export type ListAppsOutput = {
  apps: Array<{
    id: string;
    name: string;
    spaceId?: string;
    ownerId?: string;
    createdAt?: string;
    updatedAt?: string;
    description?: string;
  }>;
  nextCursor?: string;
};

export const listAppsTool = defineTool({
  name: 'list_apps',
  description:
    'List Qlik Sense apps in the tenant. Use this to discover which apps exist before querying. ' +
    'Returns app id, name, owner, space, and timestamps. ' +
    'Supports name substring search (`query`), space filter (`spaceId`), and pagination via `cursor`. ' +
    'Default limit is 50; max 100. For more results, pass back the returned `nextCursor`.',
  input: listAppsInput,
  async run(ctx, input): Promise<ListAppsOutput> {
    const hostConfig = toHostConfig(ctx);
    const res = await callQlik(() =>
      getItems(
        {
          resourceType: 'app',
          limit: input.limit,
          ...(input.query ? { query: input.query } : {}),
          ...(input.spaceId ? { spaceId: input.spaceId } : {}),
          ...(input.cursor ? { next: input.cursor } : {}),
        },
        { hostConfig: hostConfig as never },
      ),
    );

    const data = (res.data ?? {}) as { data?: Array<Record<string, unknown>>; links?: { next?: { href?: string } } };
    const apps = (data.data ?? []).map((item) => ({
      id: String(item.resourceId ?? item.id ?? ''),
      name: String(item.name ?? ''),
      spaceId: item.spaceId ? String(item.spaceId) : undefined,
      ownerId: item.ownerId ? String(item.ownerId) : undefined,
      createdAt: item.createdAt ? String(item.createdAt) : undefined,
      updatedAt: item.updatedAt ? String(item.updatedAt) : undefined,
      description: item.description ? String(item.description) : undefined,
    }));

    const nextCursor = extractCursor(data.links?.next?.href);
    return { apps, ...(nextCursor && { nextCursor }) };
  },
});

function extractCursor(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, 'https://placeholder');
    return url.searchParams.get('next') ?? undefined;
  } catch {
    return undefined;
  }
}
