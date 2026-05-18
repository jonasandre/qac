import { describeFieldTool } from './describe-field.ts';
import { evaluateTool } from './evaluate.ts';
import { applyFiltersTool, clearFiltersTool, getFiltersTool } from './filters.ts';
import { getAppTool } from './get-app.ts';
import { listAppsTool } from './list-apps.ts';
import { listFieldsTool } from './list-fields.ts';
import { listMasterItemsTool } from './list-master-items.ts';
import { listSheetsTool } from './list-sheets.ts';
import { listSpacesTool } from './list-spaces.ts';
import { queryTool } from './query.ts';
import { searchCatalogTool } from './search-catalog.ts';
import type { ToolDef } from './tool.ts';

export const allTools = [
  listAppsTool,
  getAppTool,
  listSpacesTool,
  searchCatalogTool,
  listFieldsTool,
  listMasterItemsTool,
  listSheetsTool,
  describeFieldTool,
  applyFiltersTool,
  clearFiltersTool,
  getFiltersTool,
  queryTool,
  evaluateTool,
] as const;

export type AnyTool = ToolDef<never, unknown>;

export function findTool(name: string): (typeof allTools)[number] | undefined {
  return allTools.find((t) => t.name === name);
}
