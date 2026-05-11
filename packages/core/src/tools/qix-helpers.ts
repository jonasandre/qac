import type { QixAppHandle } from '../session/manager.ts';

export type QixDoc = {
  getAppLayout: () => Promise<unknown>;
  getFieldList: () => Promise<unknown[]>;
  getDimensionList: () => Promise<unknown[]>;
  getMeasureList: () => Promise<unknown[]>;
  getSheetList: () => Promise<unknown[]>;
  getField: (name: string) => Promise<{ getCardinal: () => Promise<number> }>;
  evaluate: (expression: string) => Promise<string>;
  evaluateEx: (expression: string) => Promise<{ qNum?: number; qText?: string; qIsNumeric?: boolean }>;
  createSessionObject: (props: unknown) => Promise<{
    getLayout: () => Promise<unknown>;
    getHyperCubeData: (path: string, pages: NxPage[]) => Promise<NxDataPage[]>;
  }>;
};

export type NxPage = { qLeft: number; qTop: number; qWidth: number; qHeight: number };
export type NxDataPage = {
  qMatrix: Array<Array<{ qText?: string; qNum?: number; qElemNumber?: number; qState?: string }>>;
  qArea?: { qLeft: number; qTop: number; qWidth: number; qHeight: number };
};

export function asDoc(handle: QixAppHandle): QixDoc {
  return handle.doc as QixDoc;
}
