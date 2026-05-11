import { getAppInfo } from '@qlik/api/apps';
import { z } from 'zod';
import { callQlik, toHostConfig } from '../client.ts';
import { QacError } from '../errors.ts';
import { defineTool } from './tool.ts';

export const getAppInput = z.object({
  appId: z.string().min(1).describe('The Qlik app ID (UUID).'),
});

export type GetAppInput = z.infer<typeof getAppInput>;

export type GetAppOutput = {
  id: string;
  name: string;
  description?: string;
  spaceId?: string;
  ownerId?: string;
  createdAt?: string;
  modifiedAt?: string;
  published?: boolean;
  publishTime?: string;
  thumbnail?: string;
};

export const getAppTool = defineTool({
  name: 'get_app',
  description:
    'Fetch metadata about a single Qlik app: name, description, owner, space, timestamps, publication status. ' +
    'Use after `list_apps` when you need richer detail about a specific app before introspection or querying.',
  input: getAppInput,
  async run(ctx, input): Promise<GetAppOutput> {
    const hostConfig = toHostConfig(ctx);
    let res: Awaited<ReturnType<typeof getAppInfo>>;
    try {
      res = await getAppInfo(input.appId, { hostConfig: hostConfig as never });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        throw new QacError('APP_NOT_FOUND', `app '${input.appId}' not found`);
      }
      throw err;
    }

    const data = (res.data ?? {}) as Record<string, unknown>;
    const attrs = (data.attributes ?? {}) as Record<string, unknown>;

    return {
      id: String(data.id ?? input.appId),
      name: String(attrs.name ?? ''),
      description: attrs.description ? String(attrs.description) : undefined,
      spaceId: attrs.spaceId ? String(attrs.spaceId) : undefined,
      ownerId: attrs.ownerId ? String(attrs.ownerId) : undefined,
      createdAt: attrs.createdDate ? String(attrs.createdDate) : undefined,
      modifiedAt: attrs.modifiedDate ? String(attrs.modifiedDate) : undefined,
      published: typeof attrs.published === 'boolean' ? attrs.published : undefined,
      publishTime: attrs.publishTime ? String(attrs.publishTime) : undefined,
      thumbnail: attrs.thumbnail ? String(attrs.thumbnail) : undefined,
    };
  },
});
