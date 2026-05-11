import type { ContextSummary, QlikContext } from '../types.ts';

export interface ContextProvider {
  resolve(name?: string): Promise<QlikContext>;
  list(): Promise<ContextSummary[]>;
  active(): Promise<string | null>;
}
