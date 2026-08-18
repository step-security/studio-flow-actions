import { z } from "zod";
import type { ConfigFile } from "../config/schema";
import { readFlexRoutingNames, readQueueWorkflowName } from "./attributes";
import { transitionSchema } from "./flow-schema";
import type { TwilioResources } from "./resources";
import { matchesServiceName, splitFunctionUrl } from "./function-url";
import { ManagedWidgetType } from "./widget-types";

/** A single field rewrite, surfaced in logs and the run summary. */
export interface WidgetChange {
  widget: string;
  type: string;
  field: string;
  value: string;
}

/** A semantic problem with a widget, reported against a dotted field path. */
export interface WidgetIssue {
  path: string[];
  message: string;
}

/**
 * Each managed widget type is described in one place: the shape it must have,
 * the semantic rules it must satisfy, and how its SIDs are rewritten. Adding a
 * type means adding one entry here rather than touching a schema union, a
 * validation switch and a chain of update functions separately.
 */
export interface WidgetHandler<TWidget = any> {
  readonly type: ManagedWidgetType;
  /**
   * Structural validation for this widget type. The input side is deliberately
   * loose: schemas apply defaults, so what they accept differs from what they
   * produce, and only the produced shape matters to callers.
   */
  readonly schema: z.ZodType<TWidget, z.ZodTypeDef, any>;
  /**
   * Semantic checks. `resources` is present only when the account can be
   * reached, so rules needing remote state are skipped during offline checks.
   */
  inspect(widget: TWidget, config: ConfigFile, resources?: TwilioResources): WidgetIssue[];
  /** Rewrites the widget in place and reports what moved. */
  resolve(widget: TWidget, resources: TwilioResources, config: ConfigFile): WidgetChange[];
}

const widgetBase = z
  .object({
    name: z.string(),
    transitions: z.array(transitionSchema),
  })
  .passthrough();

const passthroughObject = z.object({}).passthrough();

const keyedValue = z
  .object({ key: z.string(), value: z.string(), type: z.string().default("string") })
  .passthrough();

/** Builds a change record, keeping call sites terse. */
function change(widget: { name: string }, type: string, field: string, value: string): WidgetChange {
  return { widget: widget.name, type, field, value };
}

// ---------------------------------------------------------------------------
// run-function
// ---------------------------------------------------------------------------

const runFunctionSchema = widgetBase.merge(
  z.object({
    type: z.literal("run-function"),
    properties: passthroughObject.extend({
      service_sid: z.string().startsWith("ZS"),
      environment_sid: z.string().startsWith("ZE"),
      function_sid: z.union([z.string().startsWith("ZH"), z.string().startsWith("ZN")]),
      parameters: z.array(passthroughObject.extend({ key: z.string(), value: z.string() })).optional(),
      url: z.string(),
    }),
  })
);

type RunFunctionWidget = z.infer<typeof runFunctionSchema>;

const runFunctionHandler: WidgetHandler<RunFunctionWidget> = {
  type: "run-function",
  schema: runFunctionSchema,

  inspect(widget, config, resources) {
    const urlPath = ["properties", "url"];
    const parts = splitFunctionUrl(widget.properties.url);
    if (!parts) {
      return [{ path: urlPath, message: "Not a recognisable Twilio Functions URL." }];
    }

    const declared = config.functionServices.some((service) =>
      matchesServiceName(service, parts.serviceName)
    );
    if (!declared) {
      return [
        {
          path: urlPath,
          message: `Service '${parts.serviceName}' is not declared. Add a 'functionServices' entry for it.`,
        },
      ];
    }

    if (!resources) return [];

    const service = resources.functions.find(parts.serviceName);
    if (!service?.functions[parts.functionPath]) {
      return [
        {
          path: urlPath,
          message: `Function path '${parts.functionPath}' was not found in the deployed service. Is it deployed?`,
        },
      ];
    }

    return [];
  },

  resolve(widget, resources) {
    const parts = splitFunctionUrl(widget.properties.url)!;
    const service = resources.functions.find(parts.serviceName)!;
    const url = `https://${service.domainName}${parts.functionPath}`;

    widget.properties.service_sid = service.serviceSid;
    widget.properties.environment_sid = service.environmentSid;
    widget.properties.function_sid = service.functions[parts.functionPath];
    widget.properties.url = url;

    return [
      change(widget, this.type, "service_sid", service.serviceSid),
      change(widget, this.type, "environment_sid", service.environmentSid),
      change(widget, this.type, "function_sid", service.functions[parts.functionPath]),
      change(widget, this.type, "url", url),
    ];
  },
};

// ---------------------------------------------------------------------------
// send-to-flex
// ---------------------------------------------------------------------------

const sendToFlexSchema = widgetBase.merge(
  z.object({
    type: z.literal("send-to-flex"),
    properties: passthroughObject.extend({
      waitUrl: z.string().optional(),
      workflow: z.string().startsWith("WW"),
      channel: z.string().startsWith("TC"),
      attributes: z
        .string()
        .default("{}")
        .superRefine((attributes, ctx) => {
          const { workflowName, channelName } = readFlexRoutingNames(attributes);
          if (!workflowName) {
            ctx.addIssue({
              code: "custom",
              message:
                "attributes must include a 'workflowName' field so the workflow can be resolved at deploy time.",
            });
          }
          if (!channelName) {
            ctx.addIssue({
              code: "custom",
              message:
                "attributes must include a 'channelName' field matching a TaskChannel uniqueName.",
            });
          }
        }),
    }),
  })
);

type SendToFlexWidget = z.infer<typeof sendToFlexSchema>;

const sendToFlexHandler: WidgetHandler<SendToFlexWidget> = {
  type: "send-to-flex",
  schema: sendToFlexSchema,

  inspect(widget, _config, resources) {
    if (!resources) return [];

    const issues: WidgetIssue[] = [];
    const { workflowName, channelName } = readFlexRoutingNames(widget.properties.attributes);

    if (channelName && !resources.channelSids[channelName]) {
      issues.push({
        path: ["properties", "attributes", "channelName"],
        message: `No TaskChannel has uniqueName '${channelName}'.`,
      });
    }
    if (workflowName && !resources.workflowSids[workflowName]) {
      issues.push({
        path: ["properties", "attributes", "workflowName"],
        message: `'${workflowName}' matches no Workflow friendly name or 'workflowMap' key.`,
      });
    }
    return issues;
  },

  resolve(widget, resources) {
    const { workflowName, channelName } = readFlexRoutingNames(widget.properties.attributes);
    const channelSid = resources.channelSids[channelName!];
    const workflowSid = resources.workflowSids[workflowName!];

    widget.properties.channel = channelSid;
    widget.properties.workflow = workflowSid;

    return [
      change(widget, this.type, "channel", channelSid),
      change(widget, this.type, "workflow", workflowSid),
    ];
  },
};

// ---------------------------------------------------------------------------
// set-variables
// ---------------------------------------------------------------------------

const setVariablesSchema = widgetBase.merge(
  z.object({
    type: z.literal("set-variables"),
    properties: passthroughObject.extend({
      variables: z.array(keyedValue),
    }),
  })
);

type SetVariablesWidget = z.infer<typeof setVariablesSchema>;

const setVariablesHandler: WidgetHandler<SetVariablesWidget> = {
  type: "set-variables",
  schema: setVariablesSchema,

  inspect() {
    // Replacement values are optional by design; an unmatched key is not an error.
    return [];
  },

  resolve(widget, _resources, config) {
    const changes: WidgetChange[] = [];

    for (const [key, value] of Object.entries(config.variableReplacements ?? {})) {
      const variable = widget.properties.variables.find((entry) => entry.key === key);
      if (!variable) continue;

      variable.value = value;
      changes.push(change(widget, this.type, `variables.${key}.value`, value));
    }

    return changes;
  },
};

// ---------------------------------------------------------------------------
// run-subflow
// ---------------------------------------------------------------------------

const runSubflowSchema = widgetBase.merge(
  z.object({
    type: z.literal("run-subflow"),
    properties: passthroughObject.extend({
      parameters: z
        .array(keyedValue)
        .default([])
        .refine((parameters) => parameters.some((parameter) => parameter.key === "subflowName"), {
          message:
            "parameters must include a 'subflowName' entry so the subflow can be resolved at deploy time.",
        }),
      flow_sid: z.string().startsWith("FW"),
      flow_revision: z.string(),
    }),
  })
);

type RunSubflowWidget = z.infer<typeof runSubflowSchema>;

/** Reads the subflowName parameter, which the schema has already required. */
function subflowNameOf(widget: RunSubflowWidget): string | undefined {
  return widget.properties.parameters.find((parameter) => parameter.key === "subflowName")?.value;
}

const runSubflowHandler: WidgetHandler<RunSubflowWidget> = {
  type: "run-subflow",
  schema: runSubflowSchema,

  inspect(widget, config, resources) {
    if (!resources) return [];

    const subflowName = subflowNameOf(widget);
    // A missing name is already reported by the schema.
    if (!subflowName) return [];

    // Subflows created later in this same run are legitimate targets, even
    // though they do not exist on the account yet.
    const pending = config.flows
      .filter((flow) => flow.subflow && flow.allowCreate)
      .map((flow) => flow.name);

    if (resources.flowSids[subflowName] || pending.includes(subflowName)) return [];

    return [
      {
        path: ["properties", "parameters", "subflowName"],
        message: `'${subflowName}' matches no Studio Flow friendly name, 'subflowMap' key, or subflow with allowCreate enabled.`,
      },
    ];
  },

  resolve(widget, resources) {
    const subflowName = subflowNameOf(widget)!;
    const subflowSid = resources.flowSids[subflowName];

    widget.properties.flow_sid = subflowSid;

    // A subflow created later in the run has no SID yet; the placeholder makes
    // that explicit in the change table rather than showing "undefined".
    return [change(widget, this.type, "flow_sid", subflowSid ?? "<known after deploy>")];
  },
};

// ---------------------------------------------------------------------------
// enqueue-call
// ---------------------------------------------------------------------------

const enqueueCallSchema = widgetBase.merge(
  z.object({
    type: z.literal("enqueue-call"),
    properties: passthroughObject.extend({
      workflow_sid: z.string().startsWith("WW"),
      task_attributes: z
        .string()
        .default("{}")
        .superRefine((attributes, ctx) => {
          if (!readQueueWorkflowName(attributes).workflowName) {
            ctx.addIssue({
              code: "custom",
              message:
                "task_attributes must include a 'workflowName' field so the workflow can be resolved at deploy time.",
            });
          }
        }),
    }),
  })
);

type EnqueueCallWidget = z.infer<typeof enqueueCallSchema>;

const enqueueCallHandler: WidgetHandler<EnqueueCallWidget> = {
  type: "enqueue-call",
  schema: enqueueCallSchema,

  inspect(widget, _config, resources) {
    if (!resources) return [];

    const { workflowName } = readQueueWorkflowName(widget.properties.task_attributes);
    if (!workflowName || resources.workflowSids[workflowName]) return [];

    return [
      {
        path: ["properties", "task_attributes", "workflowName"],
        message: `'${workflowName}' matches no Workflow friendly name or 'workflowMap' key.`,
      },
    ];
  },

  resolve(widget, resources) {
    const { workflowName } = readQueueWorkflowName(widget.properties.task_attributes);
    const workflowSid = resources.workflowSids[workflowName!];

    widget.properties.workflow_sid = workflowSid;

    return [change(widget, this.type, "workflow_sid", workflowSid)];
  },
};

// ---------------------------------------------------------------------------

export const WIDGET_HANDLERS: Record<ManagedWidgetType, WidgetHandler> = {
  "run-function": runFunctionHandler,
  "send-to-flex": sendToFlexHandler,
  "set-variables": setVariablesHandler,
  "run-subflow": runSubflowHandler,
  "enqueue-call": enqueueCallHandler,
};

export type ManagedWidget =
  | RunFunctionWidget
  | SendToFlexWidget
  | SetVariablesWidget
  | RunSubflowWidget
  | EnqueueCallWidget;
