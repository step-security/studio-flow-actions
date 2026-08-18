import { readRepositoryFile } from "../config/load";
import type { ConfigFile, FlowEntry } from "../config/schema";
import { runtime } from "../runtime";
import { parseFlowDefinition, FlowDefinition } from "../studio/flow-schema";
import { inspectManagedWidgets } from "../studio/managed-widgets";
import type { TwilioResources } from "../studio/resources";
import { WIDGET_HANDLERS, WidgetChange } from "../studio/widget-registry";

export interface PreparedFlow {
  flow: FlowEntry;
  definition: FlowDefinition;
  changes: WidgetChange[];
}

/**
 * Applies a custom property override, which reaches any widget by name — not
 * only managed types — and sets a single property to a literal string.
 */
function applyCustomProperty(
  definition: FlowDefinition,
  widgetName: string,
  key: string,
  value: string
): WidgetChange[] {
  const state = definition.states.find((candidate) => candidate.name === widgetName);
  if (!state) {
    runtime.warn(`Custom replacement skipped: no widget named '${widgetName}' in this flow.`);
    return [];
  }

  state.properties[key] = value;
  return [{ widget: widgetName, type: state.type, field: key, value }];
}

/**
 * Rewrites every configured flow's definition against the target account.
 *
 * Subflows are processed first: a parent flow's run-subflow widget needs its
 * child's SID, and a child created during this run only has one once it has been
 * pushed. Ordering by subflow-first means the SID is available by the time the
 * parent is written.
 */
export async function prepareFlows(
  config: ConfigFile,
  resources: TwilioResources
): Promise<{ prepared: PreparedFlow[]; ok: boolean }> {
  const ordered = [...config.flows].sort(
    (first, second) => Number(second.subflow) - Number(first.subflow)
  );

  const prepared: PreparedFlow[] = [];
  let ok = true;

  for (const flow of ordered) {
    const source = await readRepositoryFile(flow.path);
    const definition = parseFlowDefinition(source, flow.path);

    const inspection = inspectManagedWidgets(definition, config, resources);
    if (!inspection.ok) {
      ok = false;
      continue;
    }

    const changes: WidgetChange[] = [];

    // Only the widget types the configuration opts into are rewritten.
    for (const widget of inspection.widgets) {
      if (!config.replaceWidgetTypes.includes(widget.type)) continue;
      changes.push(...WIDGET_HANDLERS[widget.type].resolve(widget, resources, config));
    }

    // Handlers mutate their own copy of each state, so the results are written
    // back into the definition that will be published.
    for (const widget of inspection.widgets) {
      const index = definition.states.findIndex((state) => state.name === widget.name);
      if (index >= 0) definition.states[index] = widget as FlowDefinition["states"][number];
    }

    for (const override of config.customPropertyReplacements) {
      if (override.flowName !== flow.name) continue;
      changes.push(
        ...applyCustomProperty(
          definition,
          override.widgetName,
          override.propertyKey,
          override.propertyValue
        )
      );
    }

    prepared.push({ flow, definition, changes });
  }

  return { prepared, ok };
}

/**
 * Publishes a prepared definition, creating the flow when it does not exist yet.
 *
 * `resources.flowSids` is updated after a create so that a parent flow later in
 * the same run resolves the new subflow's SID.
 */
export async function publishFlow(
  entry: PreparedFlow,
  resources: TwilioResources,
  commitMessage: string
): Promise<void> {
  const { flow, definition } = entry;
  const { client } = resources;

  if (flow.sid) {
    await client.studio.v2.flows(flow.sid).update({ definition, status: "published" });
    return;
  }

  const existingSid = resources.flowSids[flow.name];

  if (existingSid) {
    await client.studio.v2
      .flows(existingSid)
      .update({ definition, commitMessage, status: "published" });
    return;
  }

  if (!flow.allowCreate) {
    // load-resources already rejects this case; guard in case ordering changes.
    runtime.fail(`Flow '${flow.name}' does not exist and 'allowCreate' is not enabled.`);
  }

  const created = await client.studio.v2.flows.create({
    friendlyName: flow.name,
    definition,
    commitMessage,
    status: "published",
  });
  resources.flowSids[flow.name] = created.sid;
  runtime.info(`Created Studio Flow '${flow.name}' (${created.sid})`);
}

/** Prefix marking a revision as written by this pipeline. */
export const AUTO_DEPLOY_PREFIX = "[Auto Deploy]";

/** Builds the commit message stored against a published revision. */
export function buildCommitMessage(): string {
  const provided = runtime.readInput("COMMIT_MESSAGE");
  return provided ? `${AUTO_DEPLOY_PREFIX} ${provided}` : AUTO_DEPLOY_PREFIX;
}
