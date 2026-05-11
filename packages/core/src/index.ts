export * from './types.ts';
export * from './errors.ts';
export * from './usage.ts';
export { toHostConfig } from './client.ts';

export type { ContextProvider } from './context/provider.ts';
export { FileContextProvider, DEFAULT_CONFIG_PATH } from './context/file-provider.ts';
export { EnvContextProvider, hasEnvContext, readEnvContext } from './context/env-provider.ts';
export { CompositeContextProvider } from './context/composite-provider.ts';

export type { QixSessionManager, QixAppHandle } from './session/manager.ts';
export { EphemeralSessionManager } from './session/ephemeral.ts';

export { defineTool } from './tools/tool.ts';
export type { ToolDef, ToolDeps } from './tools/tool.ts';

export { allTools, findTool } from './tools/registry.ts';

export { listAppsTool, listAppsInput } from './tools/list-apps.ts';
export type { ListAppsInput, ListAppsOutput } from './tools/list-apps.ts';

export { getAppTool, getAppInput } from './tools/get-app.ts';
export type { GetAppInput, GetAppOutput } from './tools/get-app.ts';

export { listSpacesTool, listSpacesInput } from './tools/list-spaces.ts';
export type { ListSpacesInput, ListSpacesOutput } from './tools/list-spaces.ts';

export { searchCatalogTool, searchCatalogInput } from './tools/search-catalog.ts';
export type { SearchCatalogInput, SearchCatalogOutput } from './tools/search-catalog.ts';

export { listFieldsTool, listFieldsInput } from './tools/list-fields.ts';
export type { ListFieldsInput, ListFieldsOutput } from './tools/list-fields.ts';

export { listMasterItemsTool, listMasterItemsInput } from './tools/list-master-items.ts';
export type {
  ListMasterItemsInput,
  ListMasterItemsOutput,
  MasterDimension,
  MasterMeasure,
} from './tools/list-master-items.ts';

export { listSheetsTool, listSheetsInput } from './tools/list-sheets.ts';
export type { ListSheetsInput, ListSheetsOutput } from './tools/list-sheets.ts';

export { describeFieldTool, describeFieldInput } from './tools/describe-field.ts';
export type { DescribeFieldInput, DescribeFieldOutput } from './tools/describe-field.ts';

export { queryTool, queryInput } from './tools/query.ts';
export type { QueryInput, QueryOutput, QueryRow } from './tools/query.ts';

export { evaluateTool, evaluateInput } from './tools/evaluate.ts';
export type { EvaluateInput, EvaluateOutput } from './tools/evaluate.ts';
