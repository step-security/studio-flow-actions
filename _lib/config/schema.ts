import { z } from "zod";
import { MANAGED_WIDGET_TYPES } from "../studio/widget-types";

/**
 * Flow paths are resolved relative to the repository root. A leading "./" is
 * dropped so the same path can be used for reads, writes and git tree entries;
 * escaping upwards is refused outright.
 */
const flowPath = z.string().superRefine((value, ctx) => {
  if (value.startsWith("../")) {
    ctx.addIssue({
      code: "custom",
      message: "Flow paths are relative to the repository root and cannot traverse upwards.",
    });
  }
});

const flowEntry = z.object({
  name: z.string(),
  path: flowPath.transform((value) => (value.startsWith("./") ? value.slice(2) : value)),
  /** Targets a specific flow directly; otherwise the flow is matched on name. */
  sid: z.string().optional(),
  subflow: z.boolean().default(false),
  /** Permits the flow to be created when it is not already on the account. */
  allowCreate: z.boolean().default(false),
});

/**
 * `environmentSuffix` accepts a literal 0 to mean "whichever environment comes
 * first", which is how single-environment services are addressed.
 */
const functionServiceEntry = z.object({
  name: z.string(),
  environmentSuffix: z.union([z.string(), z.null(), z.literal(0)]),
  /** Treats `name` as a regular expression rather than an exact unique name. */
  pattern: z.boolean().optional(),
});

const customPropertyReplacement = z.object({
  flowName: z.string(),
  widgetName: z.string(),
  propertyKey: z.string(),
  propertyValue: z.string(),
});

export const configFileSchema = z.object({
  flows: z.array(flowEntry),
  replaceWidgetTypes: z.array(z.enum(MANAGED_WIDGET_TYPES)).default([]),
  functionServices: z.array(functionServiceEntry).default([]),
  /** Overrides or supplements workflow friendly-name to SID resolution. */
  workflowMap: z.record(z.string()).optional(),
  /** Overrides or supplements subflow friendly-name to SID resolution. */
  subflowMap: z.record(z.string()).optional(),
  /** Values injected into matching set-variables widget keys. */
  variableReplacements: z.record(z.string()).optional(),
  customPropertyReplacements: z.array(customPropertyReplacement).default([]),
  /** Expands $VAR references in this file from the process environment. */
  enableShellVariables: z.boolean().default(false),
});

export type ConfigFile = z.infer<typeof configFileSchema>;
export type FlowEntry = ConfigFile["flows"][number];
export type FunctionServiceEntry = ConfigFile["functionServices"][number];
