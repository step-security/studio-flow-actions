import type { Twilio } from "twilio";
import type { ConfigFile } from "../config/schema";
import { createFlowDirectory, FlowDirectory } from "../services/flows";
import { createFunctionCatalog } from "../services/serverless";
import { readTaskrouterMaps } from "../services/taskrouter";
import type { TwilioResources } from "../studio/resources";

export interface LoadedResources {
  resources: TwilioResources;
  flows: FlowDirectory;
}

/**
 * Reads everything the run needs from the Twilio account in one pass.
 *
 * Configured `workflowMap` and `subflowMap` entries are layered over what the
 * account reports, so a name can be pinned to a specific SID — used when a
 * friendly name is ambiguous, or when targeting a resource in another account.
 */
export async function loadResources(
  config: ConfigFile,
  client: Twilio
): Promise<LoadedResources> {
  const [taskrouter, flows, functions] = await Promise.all([
    readTaskrouterMaps(client),
    createFlowDirectory(client),
    createFunctionCatalog(client, config.functionServices),
  ]);

  const resources: TwilioResources = {
    client,
    functions,
    channelSids: taskrouter.channelSids,
    workflowSids: { ...taskrouter.workflowSids, ...(config.workflowMap ?? {}) },
    flowSids: { ...flows.sidsByName(), ...(config.subflowMap ?? {}) },
  };

  assertConfiguredFlowsExist(config, flows);

  return { resources, flows };
}

/**
 * Confirms up front that each configured flow can be located, so a run fails
 * before it starts rewriting rather than partway through deploying.
 *
 * Flows with `allowCreate` are exempt, since not existing yet is the point.
 */
function assertConfiguredFlowsExist(config: ConfigFile, flows: FlowDirectory): void {
  for (const flow of config.flows) {
    if (flow.sid) {
      flows.requireBySid(flow.sid);
    } else if (!flow.allowCreate) {
      flows.requireByName(flow.name);
    }
  }
}
