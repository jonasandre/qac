import { z } from 'zod';

// All limits sized to comfortably exceed real dashboard queries while
// blocking megabyte-scale payloads / DoS via the MCP/CLI surface.
export const FILTER_LIMITS = {
  arrayDimensions: 50,
  arrayMeasures: 50,
  arrayFilters: 50,
  arrayFilterValues: 1000,
  arraySort: 10,
  stringField: 256,
  stringValue: 256,
  stringExpression: 5000,
} as const;

export const filterValueSchema = z.union([z.string().max(FILTER_LIMITS.stringValue), z.number()]);

export const filterSchema = z.object({
  field: z.string().max(FILTER_LIMITS.stringField).describe('Field name to filter on.'),
  values: z
    .array(filterValueSchema)
    .max(FILTER_LIMITS.arrayFilterValues)
    .describe('Values to keep.'),
});

export type FilterInput = z.infer<typeof filterSchema>;
export type FilterValueInput = z.infer<typeof filterValueSchema>;
