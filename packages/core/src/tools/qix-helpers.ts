import type { QixAppHandle } from '../session/manager.ts';

export type QixDoc = {
  getAppLayout: () => Promise<unknown>;
  getFieldList: () => Promise<unknown[]>;
  getDimensionList: () => Promise<unknown[]>;
  getMeasureList: () => Promise<unknown[]>;
  getSheetList: () => Promise<unknown[]>;
  getField: (name: string) => Promise<QixField>;
  clearAll?: (lockedAlso?: boolean, stateName?: string) => Promise<boolean | undefined>;
  evaluate: (expression: string) => Promise<string>;
  evaluateEx: (
    expression: string,
  ) => Promise<{ qNum?: number; qText?: string; qIsNumeric?: boolean }>;
  createSessionObject: (props: unknown) => Promise<{
    getLayout: () => Promise<unknown>;
    getHyperCubeData: (path: string, pages: NxPage[]) => Promise<NxDataPage[]>;
    getListObjectData?: (path: string, pages: NxPage[]) => Promise<NxDataPage[]>;
  }>;
};

export type QixField = {
  getCardinal: () => Promise<number>;
  selectValues?: (
    values: QixFieldValue[],
    toggleMode?: boolean,
    softLock?: boolean,
  ) => Promise<boolean | undefined>;
  clear?: () => Promise<boolean | undefined>;
};

export type QixFieldValue = {
  qText?: string;
  qIsNumeric?: boolean;
  qNumber?: number;
};

export type QixStateCounts = {
  qSelected?: number;
  qLocked?: number;
  qOption?: number;
  qDeselected?: number;
  qAlternative?: number;
  qExcluded?: number;
  qSelectedExcluded?: number;
  qLockedExcluded?: number;
};

export type QixSelectionSummary = {
  qField: string;
  qSelected?: string;
  qSelectedCount?: number;
  qTotal?: number;
  qStateCounts?: QixStateCounts;
};

export type NxPage = { qLeft: number; qTop: number; qWidth: number; qHeight: number };
export type NxDataPage = {
  qMatrix: Array<Array<{ qText?: string; qNum?: number; qElemNumber?: number; qState?: string }>>;
  qArea?: { qLeft: number; qTop: number; qWidth: number; qHeight: number };
};

export function asDoc(handle: QixAppHandle): QixDoc {
  return handle.doc as QixDoc;
}
