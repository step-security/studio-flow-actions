import { backfillDeployProperties } from "../pipeline/backfill";
import { readFlexRoutingNames, readQueueWorkflowName } from "../studio/attributes";
import type { FlowDirectory } from "../services/flows";
import { configOf, flowWith, state } from "./helpers/fixtures";

jest.mock("../runtime", () => ({
  runtime: {
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    fail: jest.fn((message: string) => {
      throw new Error(message);
    }),
  },
}));

const WORKFLOW_SID = "WW10000000000000000000000000000000";
const CHANNEL_SID = "TC10000000000000000000000000000000";
const SUBFLOW_SID = "FW10000000000000000000000000000000";

const taskrouter = {
  workflowSids: { "Assign to Anyone": WORKFLOW_SID },
  channelSids: { voice: CHANNEL_SID },
};

function flowDirectory(flows: Array<{ sid: string; friendlyName: string }>): FlowDirectory {
  return {
    all: () => flows as never,
    findBySid: (sid) => flows.find((flow) => flow.sid === sid) as never,
    findByName: (name) => flows.find((flow) => flow.friendlyName === name) as never,
    requireBySid: (sid) => flows.find((flow) => flow.sid === sid) as never,
    requireByName: (name) => flows.find((flow) => flow.friendlyName === name) as never,
    sidsByName: () => Object.fromEntries(flows.map((flow) => [flow.friendlyName, flow.sid])),
    fetchDefinition: async () => ({}),
  };
}

const context = (overrides: Partial<Parameters<typeof backfillDeployProperties>[1]> = {}) => ({
  config: configOf({}),
  taskrouter,
  flows: flowDirectory([{ sid: SUBFLOW_SID, friendlyName: "Shared Menu" }]),
  flowName: "Test Flow",
  ...overrides,
});

describe("send-to-flex backfill", () => {
  it("adds both names by reversing the SIDs", () => {
    const definition = flowWith(
      state("RouteToAgent", "send-to-flex", {
        workflow: WORKFLOW_SID,
        channel: CHANNEL_SID,
        attributes: "{}",
      })
    );

    const notes = backfillDeployProperties(definition, context());

    expect(readFlexRoutingNames(definition.states[1].properties.attributes as string)).toEqual({
      workflowName: "Assign to Anyone",
      channelName: "voice",
    });
    expect(notes).toHaveLength(2);
  });

  it("leaves names that are already present alone", () => {
    const definition = flowWith(
      state("RouteToAgent", "send-to-flex", {
        workflow: WORKFLOW_SID,
        channel: CHANNEL_SID,
        attributes: '{"workflowName":"Custom","channelName":"chat"}',
      })
    );

    expect(backfillDeployProperties(definition, context())).toHaveLength(0);
    expect(definition.states[1].properties.attributes).toBe(
      '{"workflowName":"Custom","channelName":"chat"}'
    );
  });

  it("prefers a configured workflowMap entry over the account", () => {
    const definition = flowWith(
      state("RouteToAgent", "send-to-flex", {
        workflow: WORKFLOW_SID,
        channel: CHANNEL_SID,
        attributes: "{}",
      })
    );
    const config = configOf({ workflowMap: { "Mapped Name": WORKFLOW_SID } });

    backfillDeployProperties(definition, context({ config }));

    expect(readFlexRoutingNames(definition.states[1].properties.attributes as string).workflowName).toBe(
      "Mapped Name"
    );
  });

  it("fails when the workflow SID belongs to no known workflow", () => {
    const definition = flowWith(
      state("RouteToAgent", "send-to-flex", {
        workflow: "WW99999999999999999999999999999999",
        channel: CHANNEL_SID,
        attributes: "{}",
      })
    );

    expect(() => backfillDeployProperties(definition, context())).toThrow(/no Workflow/);
  });
});

describe("run-subflow backfill", () => {
  it("adds subflowName from the flow directory", () => {
    const definition = flowWith(
      state("CallSubflow", "run-subflow", {
        flow_sid: SUBFLOW_SID,
        flow_revision: "LatestPublished",
        parameters: [],
      })
    );

    backfillDeployProperties(definition, context());

    const parameters = definition.states[1].properties.parameters as Array<{
      key: string;
      value: string;
    }>;
    expect(parameters).toContainEqual({ key: "subflowName", value: "Shared Menu", type: "string" });
  });

  it("keeps an existing subflowName", () => {
    const definition = flowWith(
      state("CallSubflow", "run-subflow", {
        flow_sid: SUBFLOW_SID,
        flow_revision: "LatestPublished",
        parameters: [{ key: "subflowName", value: "Already Set", type: "string" }],
      })
    );

    expect(backfillDeployProperties(definition, context())).toHaveLength(0);
  });

  it("fails when the subflow SID is unknown", () => {
    const definition = flowWith(
      state("CallSubflow", "run-subflow", {
        flow_sid: "FW99999999999999999999999999999999",
        flow_revision: "LatestPublished",
        parameters: [],
      })
    );

    expect(() => backfillDeployProperties(definition, context())).toThrow(/no Studio Flow/);
  });
});

describe("enqueue-call backfill", () => {
  /**
   * enqueue-call names its properties workflow_sid and task_attributes, unlike
   * send-to-flex which uses workflow and attributes. Reading or writing the
   * send-to-flex names here silently produces a definition that cannot deploy.
   */
  it("reads workflow_sid and writes back to task_attributes", () => {
    const definition = flowWith(
      state("Enqueue", "enqueue-call", {
        workflow_sid: WORKFLOW_SID,
        task_attributes: "{}",
      })
    );

    const notes = backfillDeployProperties(definition, context());
    const properties = definition.states[1].properties;

    expect(readQueueWorkflowName(properties.task_attributes as string).workflowName).toBe(
      "Assign to Anyone"
    );
    expect(properties.attributes).toBeUndefined();
    expect(notes).toHaveLength(1);
  });

  it("keeps an existing workflowName", () => {
    const definition = flowWith(
      state("Enqueue", "enqueue-call", {
        workflow_sid: WORKFLOW_SID,
        task_attributes: '{"workflowName":"Callback"}',
      })
    );

    expect(backfillDeployProperties(definition, context())).toHaveLength(0);
  });
});

describe("unmanaged widgets", () => {
  it("are left entirely alone", () => {
    const definition = flowWith(state("Say", "say-play", { say: "hello" }));
    expect(backfillDeployProperties(definition, context())).toHaveLength(0);
    expect(definition.states[1].properties).toEqual({ say: "hello" });
  });
});
