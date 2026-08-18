import type { Twilio } from "twilio";
import type { FlowInstance } from "twilio/lib/rest/studio/v2/flow";
import { runtime } from "../runtime";

export interface FlowDirectory {
  /** Every flow on the account, as fetched when the directory was built. */
  all(): FlowInstance[];
  findByName(friendlyName: string): FlowInstance | undefined;
  findBySid(sid: string): FlowInstance | undefined;
  /** Fails the run when no flow matches the friendly name. */
  requireByName(friendlyName: string): FlowInstance;
  /** Fails the run when no flow matches the SID. */
  requireBySid(sid: string): FlowInstance;
  /** friendlyName to SID for every flow on the account. */
  sidsByName(): Record<string, string>;
  /** Fetches the current published definition of a flow. */
  fetchDefinition(sid: string): Promise<Record<string, unknown>>;
}

/**
 * Loads the account's Studio flows once and answers lookups from memory. The
 * flow list is needed by nearly every code path, and paging it repeatedly would
 * dominate the runtime of an otherwise cheap action.
 */
export async function createFlowDirectory(client: Twilio): Promise<FlowDirectory> {
  runtime.debug("Studio: listing flows");

  let flows: FlowInstance[];
  try {
    flows = await client.studio.v2.flows.list();
  } catch (error) {
    runtime.fail(`Could not list Studio Flows: ${(error as Error).message}`);
  }

  const findByName = (friendlyName: string) =>
    flows.find((flow) => flow.friendlyName === friendlyName);

  const findBySid = (sid: string) => flows.find((flow) => flow.sid === sid);

  return {
    all: () => flows,

    findByName,

    findBySid,

    requireByName(friendlyName) {
      const flow = findByName(friendlyName);
      if (!flow) runtime.fail(`No Studio Flow named '${friendlyName}' exists on this account.`);
      return flow;
    },

    requireBySid(sid) {
      const flow = findBySid(sid);
      if (!flow) runtime.fail(`No Studio Flow with SID '${sid}' exists on this account.`);
      return flow;
    },

    sidsByName: () =>
      Object.fromEntries(flows.map((flow) => [flow.friendlyName, flow.sid])) as Record<
        string,
        string
      >,

    fetchDefinition: async (sid) => {
      runtime.debug(`Studio: fetching definition for ${sid}`);
      const flow = await client.studio.v2.flows(sid).fetch();
      return flow.definition;
    },
  };
}
