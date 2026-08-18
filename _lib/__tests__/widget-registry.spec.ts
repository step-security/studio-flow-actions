import { inspectManagedWidgets } from "../studio/managed-widgets";
import { WIDGET_HANDLERS } from "../studio/widget-registry";
import { configOf, flowWith, functionCatalogOf, resourcesOf, state } from "./helpers/fixtures";

jest.mock("../runtime", () => ({
  runtime: {
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    fail: jest.fn(() => {
      throw new Error("failed");
    }),
  },
}));

const SERVICE = {
  uniqueName: "my-api",
  serviceSid: "ZS10000000000000000000000000000000",
  environmentSid: "ZE10000000000000000000000000000000",
  domainName: "my-api-1234-dev.twil.io",
  functions: { "/lookup": "ZH10000000000000000000000000000000" },
};

const runFunction = (url: string) =>
  state("CallApi", "run-function", {
    service_sid: "ZS00000000000000000000000000000000",
    environment_sid: "ZE00000000000000000000000000000000",
    function_sid: "ZH00000000000000000000000000000000",
    url,
  });

const sendToFlex = (attributes: string) =>
  state("RouteToAgent", "send-to-flex", {
    workflow: "WW00000000000000000000000000000000",
    channel: "TC00000000000000000000000000000000",
    attributes,
  });

describe("run-function widgets", () => {
  const config = configOf({
    replaceWidgetTypes: ["run-function"],
    functionServices: [{ name: "my-api", environmentSuffix: "dev" }],
  });

  it("rewrites every SID and the URL to the resolved service", () => {
    const flow = flowWith(runFunction("https://my-api-1234-dev.twil.io/lookup"));
    const resources = resourcesOf({ functions: functionCatalogOf([SERVICE]) });

    const { widgets, ok } = inspectManagedWidgets(flow, config, resources);
    expect(ok).toBe(true);

    const changes = WIDGET_HANDLERS["run-function"].resolve(widgets[0], resources, config);

    expect(widgets[0].properties).toMatchObject({
      service_sid: SERVICE.serviceSid,
      environment_sid: SERVICE.environmentSid,
      function_sid: SERVICE.functions["/lookup"],
      url: "https://my-api-1234-dev.twil.io/lookup",
    });
    expect(changes.map((change) => change.field)).toEqual([
      "service_sid",
      "environment_sid",
      "function_sid",
      "url",
    ]);
  });

  it("repoints the URL when the service now has a different domain", () => {
    const flow = flowWith(runFunction("https://my-api-9999-stage.twil.io/lookup"));
    const resources = resourcesOf({ functions: functionCatalogOf([SERVICE]) });

    const { widgets } = inspectManagedWidgets(flow, config, resources);
    WIDGET_HANDLERS["run-function"].resolve(widgets[0], resources, config);

    expect(widgets[0].properties.url).toBe("https://my-api-1234-dev.twil.io/lookup");
  });

  it("rejects a URL that is not a Functions domain", () => {
    const flow = flowWith(runFunction("https://example.com/lookup"));
    const { ok } = inspectManagedWidgets(flow, config, resourcesOf());
    expect(ok).toBe(false);
  });

  it("rejects a service that no functionServices entry declares", () => {
    const flow = flowWith(runFunction("https://other-api-1234-dev.twil.io/lookup"));
    const { ok } = inspectManagedWidgets(flow, config, resourcesOf());
    expect(ok).toBe(false);
  });

  it("rejects a function path missing from the deployed build", () => {
    const flow = flowWith(runFunction("https://my-api-1234-dev.twil.io/absent"));
    const resources = resourcesOf({ functions: functionCatalogOf([SERVICE]) });
    expect(inspectManagedWidgets(flow, config, resources).ok).toBe(false);
  });

  it("accepts an undeployed function path when the account is not consulted", () => {
    const flow = flowWith(runFunction("https://my-api-1234-dev.twil.io/absent"));
    expect(inspectManagedWidgets(flow, config).ok).toBe(true);
  });

  it("matches a generated service name through a pattern entry", () => {
    const patternConfig = configOf({
      replaceWidgetTypes: ["run-function"],
      functionServices: [{ name: "^plibo-callback", environmentSuffix: 0, pattern: true }],
    });
    const flow = flowWith(runFunction("https://plibo-callback-x9z-1234-dev.twil.io/lookup"));
    expect(inspectManagedWidgets(flow, patternConfig).ok).toBe(true);
  });
});

describe("send-to-flex widgets", () => {
  const config = configOf({ replaceWidgetTypes: ["send-to-flex"] });
  const resources = resourcesOf({
    channelSids: { voice: "TC10000000000000000000000000000000" },
    workflowSids: { "Assign to Anyone": "WW10000000000000000000000000000000" },
  });

  it("resolves the channel and workflow named in attributes", () => {
    const flow = flowWith(
      sendToFlex('{"workflowName":"Assign to Anyone","channelName":"voice"}')
    );

    const { widgets, ok } = inspectManagedWidgets(flow, config, resources);
    expect(ok).toBe(true);

    WIDGET_HANDLERS["send-to-flex"].resolve(widgets[0], resources, config);

    expect(widgets[0].properties).toMatchObject({
      channel: "TC10000000000000000000000000000000",
      workflow: "WW10000000000000000000000000000000",
    });
  });

  it("requires workflowName in attributes", () => {
    const flow = flowWith(sendToFlex('{"channelName":"voice"}'));
    expect(inspectManagedWidgets(flow, config, resources).ok).toBe(false);
  });

  it("requires channelName in attributes", () => {
    const flow = flowWith(sendToFlex('{"workflowName":"Assign to Anyone"}'));
    expect(inspectManagedWidgets(flow, config, resources).ok).toBe(false);
  });

  it("rejects names that match nothing on the account", () => {
    const flow = flowWith(sendToFlex('{"workflowName":"Nope","channelName":"nope"}'));
    expect(inspectManagedWidgets(flow, config, resources).ok).toBe(false);
  });

  it("tolerates Studio template expressions elsewhere in attributes", () => {
    const flow = flowWith(
      sendToFlex(
        '{"workflowName":"Assign to Anyone","channelName":"voice","from":"{{trigger.call.From}}"}'
      )
    );
    expect(inspectManagedWidgets(flow, config, resources).ok).toBe(true);
  });
});

describe("run-subflow widgets", () => {
  const config = configOf({ replaceWidgetTypes: ["run-subflow"] });

  const runSubflow = (parameters: Array<{ key: string; value: string; type: string }>) =>
    state("CallSubflow", "run-subflow", {
      flow_sid: "FW00000000000000000000000000000000",
      flow_revision: "LatestPublished",
      parameters,
    });

  const named = [{ key: "subflowName", value: "Shared Menu", type: "string" }];

  it("resolves the subflow SID from its name", () => {
    const resources = resourcesOf({ flowSids: { "Shared Menu": "FW10000000000000000000000000000000" } });
    const { widgets, ok } = inspectManagedWidgets(flowWith(runSubflow(named)), config, resources);
    expect(ok).toBe(true);

    WIDGET_HANDLERS["run-subflow"].resolve(widgets[0], resources, config);
    expect(widgets[0].properties.flow_sid).toBe("FW10000000000000000000000000000000");
  });

  it("requires a subflowName parameter", () => {
    const flow = flowWith(runSubflow([{ key: "other", value: "x", type: "string" }]));
    expect(inspectManagedWidgets(flow, config, resourcesOf()).ok).toBe(false);
  });

  it("accepts a subflow that this run will create", () => {
    const pending = configOf({
      replaceWidgetTypes: ["run-subflow"],
      flows: [{ name: "Shared Menu", path: "flows/shared.json", subflow: true, allowCreate: true }],
    });
    expect(inspectManagedWidgets(flowWith(runSubflow(named)), pending, resourcesOf()).ok).toBe(true);
  });

  it("marks the SID as pending when the subflow does not exist yet", () => {
    const pending = configOf({
      replaceWidgetTypes: ["run-subflow"],
      flows: [{ name: "Shared Menu", path: "flows/shared.json", subflow: true, allowCreate: true }],
    });
    const resources = resourcesOf();
    const { widgets } = inspectManagedWidgets(flowWith(runSubflow(named)), pending, resources);

    const changes = WIDGET_HANDLERS["run-subflow"].resolve(widgets[0], resources, pending);
    expect(changes[0].value).toBe("<known after deploy>");
  });
});

describe("enqueue-call widgets", () => {
  const config = configOf({ replaceWidgetTypes: ["enqueue-call"] });
  const resources = resourcesOf({
    workflowSids: { "Assign to Anyone": "WW10000000000000000000000000000000" },
  });

  const enqueueCall = (taskAttributes: string) =>
    state("Enqueue", "enqueue-call", {
      workflow_sid: "WW00000000000000000000000000000000",
      task_attributes: taskAttributes,
    });

  it("resolves workflow_sid from the workflowName in task_attributes", () => {
    const flow = flowWith(enqueueCall('{"workflowName":"Assign to Anyone"}'));
    const { widgets, ok } = inspectManagedWidgets(flow, config, resources);
    expect(ok).toBe(true);

    WIDGET_HANDLERS["enqueue-call"].resolve(widgets[0], resources, config);
    expect(widgets[0].properties.workflow_sid).toBe("WW10000000000000000000000000000000");
  });

  it("requires workflowName in task_attributes", () => {
    expect(inspectManagedWidgets(flowWith(enqueueCall("{}")), config, resources).ok).toBe(false);
  });
});

describe("set-variables widgets", () => {
  it("overwrites only the keys named in variableReplacements", () => {
    const config = configOf({
      replaceWidgetTypes: ["set-variables"],
      variableReplacements: { apiBaseUrl: "https://api.example.com" },
    });
    const flow = flowWith(
      state("SetVars", "set-variables", {
        variables: [
          { key: "apiBaseUrl", value: "https://old.example.com", type: "string" },
          { key: "retries", value: "3", type: "string" },
        ],
      })
    );

    const resources = resourcesOf();
    const { widgets } = inspectManagedWidgets(flow, config, resources);
    const changes = WIDGET_HANDLERS["set-variables"].resolve(widgets[0], resources, config);

    expect(widgets[0].properties.variables).toEqual([
      { key: "apiBaseUrl", value: "https://api.example.com", type: "string" },
      { key: "retries", value: "3", type: "string" },
    ]);
    expect(changes).toHaveLength(1);
  });

  it("ignores replacement keys the widget does not declare", () => {
    const config = configOf({
      replaceWidgetTypes: ["set-variables"],
      variableReplacements: { absent: "value" },
    });
    const flow = flowWith(
      state("SetVars", "set-variables", { variables: [{ key: "kept", value: "1", type: "string" }] })
    );

    const resources = resourcesOf();
    const { widgets, ok } = inspectManagedWidgets(flow, config, resources);
    expect(ok).toBe(true);
    expect(WIDGET_HANDLERS["set-variables"].resolve(widgets[0], resources, config)).toHaveLength(0);
  });
});

describe("widget collection", () => {
  it("ignores widget types the project does not manage", () => {
    const flow = flowWith(state("Say", "say-play", { say: "hello" }));
    const { widgets, ok } = inspectManagedWidgets(flow, configOf({}), resourcesOf());
    expect(ok).toBe(true);
    expect(widgets).toHaveLength(0);
  });

  it("reports every failing widget rather than stopping at the first", () => {
    const flow = flowWith(sendToFlex("{}"), state("Enqueue", "enqueue-call", {}));
    const { ok } = inspectManagedWidgets(flow, configOf({}), resourcesOf());
    expect(ok).toBe(false);
  });
});
