import type { ConfigFile } from "../config/schema";
import { runtime } from "../runtime";
import { readFlexRoutingNames, readQueueWorkflowName, withAttribute } from "../studio/attributes";
import type { FlowDefinition, FlowState } from "../studio/flow-schema";
import type { FlowDirectory } from "../services/flows";
import type { TaskrouterMaps } from "../services/taskrouter";

/**
 * Flows authored in the Studio console reference workflows, channels and
 * subflows by SID alone. Those SIDs differ per account, so a definition carrying
 * only SIDs cannot be deployed elsewhere.
 *
 * This module adds the missing name hints by looking each SID back up, turning a
 * console-authored flow into a portable one. It is the inverse of what the widget
 * registry does at deploy time.
 */

export interface BackfillContext {
  config: ConfigFile;
  taskrouter: TaskrouterMaps;
  flows: FlowDirectory;
  /** Flow name used in error messages. */
  flowName: string;
}

/** Finds the key mapping to a value, searching configured overrides first. */
function nameForSid(
  sid: string | undefined,
  overrides: Record<string, string> | undefined,
  remote: Record<string, string>
): string | undefined {
  if (!sid) return undefined;
  const fromOverrides = Object.keys(overrides ?? {}).find((key) => overrides![key] === sid);
  return fromOverrides ?? Object.keys(remote).find((key) => remote[key] === sid);
}

type Properties = Record<string, unknown>;

function backfillSendToFlex(state: FlowState, ctx: BackfillContext): string[] {
  const properties = state.properties as Properties;
  const notes: string[] = [];

  let attributes = (properties.attributes as string) ?? "{}";
  const present = readFlexRoutingNames(attributes);

  if (!present.workflowName) {
    const workflowSid = properties.workflow as string | undefined;
    const workflowName = nameForSid(
      workflowSid,
      ctx.config.workflowMap,
      ctx.taskrouter.workflowSids
    );

    if (!workflowName) {
      runtime.fail(
        `[${ctx.flowName}][${state.name}]: no Workflow on this account has SID '${workflowSid}'. Pick a valid workflow in the Studio editor.`
      );
    }

    attributes = withAttribute(attributes, "workflowName", workflowName);
    notes.push(`- **${state.name}.attributes.workflowName** <- \`${workflowName}\``);
  }

  if (!present.channelName) {
    const channelSid = properties.channel as string | undefined;
    const channelName = nameForSid(channelSid, undefined, ctx.taskrouter.channelSids);

    if (!channelName) {
      runtime.fail(
        `[${ctx.flowName}][${state.name}]: no TaskChannel on this account has SID '${channelSid}'. Pick a valid channel in the Studio editor.`
      );
    }

    attributes = withAttribute(attributes, "channelName", channelName);
    notes.push(`- **${state.name}.attributes.channelName** <- \`${channelName}\``);
  }

  properties.attributes = attributes;
  return notes;
}

function backfillRunSubflow(state: FlowState, ctx: BackfillContext): string[] {
  const properties = state.properties as Properties;
  const parameters = (properties.parameters ?? []) as Array<{
    key: string;
    value: string;
    type: string;
  }>;

  if (parameters.some((parameter) => parameter.key === "subflowName")) return [];

  const flowSid = properties.flow_sid as string | undefined;

  let subflowName = nameForSid(flowSid, ctx.config.subflowMap, {});
  if (!subflowName && flowSid) {
    subflowName = ctx.flows.findBySid(flowSid)?.friendlyName;
  }

  if (!subflowName) {
    runtime.fail(
      `[${ctx.flowName}][${state.name}]: no Studio Flow on this account has SID '${flowSid}'. Pick a valid subflow in the Studio editor.`
    );
  }

  parameters.push({ key: "subflowName", value: subflowName, type: "string" });
  properties.parameters = parameters;

  return [`- **${state.name}.parameters.subflowName** <- \`${subflowName}\``];
}

function backfillEnqueueCall(state: FlowState, ctx: BackfillContext): string[] {
  const properties = state.properties as Properties;

  let attributes = (properties.task_attributes as string) ?? "{}";
  if (readQueueWorkflowName(attributes).workflowName) return [];

  // enqueue-call names this property workflow_sid, unlike send-to-flex.
  const workflowSid = properties.workflow_sid as string | undefined;
  const workflowName = nameForSid(workflowSid, ctx.config.workflowMap, ctx.taskrouter.workflowSids);

  if (!workflowName) {
    runtime.fail(
      `[${ctx.flowName}][${state.name}]: no Workflow on this account has SID '${workflowSid}'. Pick a valid workflow in the Studio editor.`
    );
  }

  attributes = withAttribute(attributes, "workflowName", workflowName);
  properties.task_attributes = attributes;

  return [`- **${state.name}.task_attributes.workflowName** <- \`${workflowName}\``];
}

/**
 * Adds any missing deploy hints to a definition in place, returning a
 * human-readable note per adjustment for the pull request body.
 */
export function backfillDeployProperties(
  definition: FlowDefinition,
  ctx: BackfillContext
): string[] {
  const notes: string[] = [];

  for (const state of definition.states) {
    switch (state.type) {
      case "send-to-flex":
        notes.push(...backfillSendToFlex(state, ctx));
        break;
      case "run-subflow":
        notes.push(...backfillRunSubflow(state, ctx));
        break;
      case "enqueue-call":
        notes.push(...backfillEnqueueCall(state, ctx));
        break;
      default:
        break;
    }
  }

  return notes;
}
