import type { QlikContext } from '../types.ts';

export interface QixSessionManager {
  withApp<T>(ctx: QlikContext, appId: string, fn: (handle: QixAppHandle) => Promise<T>): Promise<T>;
}

export type QixAppHandle = {
  doc: unknown;
  appId: string;
};
