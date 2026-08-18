import type { Twilio } from "twilio";
import { runtime } from "../runtime";

export interface TaskrouterMaps {
  /** TaskChannel uniqueName to SID. Empty when the account has no Workspace. */
  channelSids: Record<string, string>;
  /** Workflow friendlyName to SID. Empty when the account has no Workspace. */
  workflowSids: Record<string, string>;
}

/**
 * Reads the channel and workflow name-to-SID maps from the account's first
 * Taskrouter Workspace, which on a Flex account is the only one.
 *
 * A non-Flex account may have no Workspace at all. That is not an error — it
 * simply means no send-to-flex or enqueue-call widget can be resolved, and the
 * widget validators will say so with a name that failed to match.
 */
export async function readTaskrouterMaps(client: Twilio): Promise<TaskrouterMaps> {
  const empty: TaskrouterMaps = { channelSids: {}, workflowSids: {} };

  let workspace;
  try {
    runtime.debug("Taskrouter: listing workspaces");
    [workspace] = await client.taskrouter.v1.workspaces.list();
  } catch (error) {
    runtime.fail(`Could not read the Taskrouter Workspace: ${(error as Error).message}`);
  }

  if (!workspace) {
    runtime.debug("Taskrouter: no workspace on this account");
    return empty;
  }

  try {
    runtime.debug("Taskrouter: listing task channels and workflows");
    const [channels, workflows] = await Promise.all([
      workspace.taskChannels().list(),
      workspace.workflows().list(),
    ]);

    return {
      channelSids: Object.fromEntries(channels.map((channel) => [channel.uniqueName, channel.sid])),
      workflowSids: Object.fromEntries(
        workflows.map((workflow) => [workflow.friendlyName, workflow.sid])
      ),
    };
  } catch (error) {
    runtime.fail(`Could not read Taskrouter channels or workflows: ${(error as Error).message}`);
  }
}
