import { getItems } from '@qlik/api/items';
import { z } from 'zod';
import { callQlik, toHostConfig } from '../client.ts';
import { defineTool } from './tool.ts';

export const searchCatalogInput = z.object({
  term: z.string().min(1).describe('Substring to search across catalog items (apps, datasets, qvapps).'),
  limit: z.number().int().min(1).max(100).optional().default(25),
});

export type SearchCatalogInput = z.infer<typeof searchCatalogInput>;

export type SearchCatalogOutput = {
  items: Array<{
    id: string;
    resourceId?: string;
    name: string;
    resourceType: string;
    spaceId?: string;
    description?: string;
  }>;
};

export const searchCatalogTool = defineTool({
  name: 'search_catalog',
  description:
    'Search the Qlik catalog (apps + datasets + other resources) by free-text term. ' +
    'Use this for cross-resource discovery when you do not yet know whether a name refers to an app, ' +
    'dataset, or other item. For apps specifically, prefer `list_apps`.',
  input: searchCatalogInput,
  async run(ctx, input): Promise<SearchCatalogOutput> {
    const hostConfig = toHostConfig(ctx);
    const res = await callQlik(() =>
      getItems(
        { query: input.term, limit: input.limit },
        { hostConfig: hostConfig as never },
      ),
    );

    const data = (res.data ?? {}) as { data?: Array<Record<string, unknown>> };
    const items = (data.data ?? []).map((item) => ({
      id: String(item.id ?? ''),
      resourceId: item.resourceId ? String(item.resourceId) : undefined,
      name: String(item.name ?? ''),
      resourceType: String(item.resourceType ?? ''),
      spaceId: item.spaceId ? String(item.spaceId) : undefined,
      description: item.description ? String(item.description) : undefined,
    }));

    return { items };
  },
});
