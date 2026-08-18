import { configFileSchema } from "../config/schema";
import { flowDefinitionSchema } from "../studio/flow-schema";

describe("configuration file schema", () => {
  const minimal = { flows: [{ name: "Main", path: "flows/main.json" }] };

  it("applies defaults for everything optional", () => {
    const config = configFileSchema.parse(minimal);

    expect(config.replaceWidgetTypes).toEqual([]);
    expect(config.functionServices).toEqual([]);
    expect(config.customPropertyReplacements).toEqual([]);
    expect(config.enableShellVariables).toBe(false);
    expect(config.flows[0]).toMatchObject({ subflow: false, allowCreate: false });
  });

  it("normalises a leading ./ on flow paths", () => {
    const config = configFileSchema.parse({
      flows: [{ name: "Main", path: "./flows/main.json" }],
    });
    expect(config.flows[0].path).toBe("flows/main.json");
  });

  it("refuses a path that escapes the repository root", () => {
    const result = configFileSchema.safeParse({
      flows: [{ name: "Main", path: "../elsewhere/main.json" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown widget type in replaceWidgetTypes", () => {
    const result = configFileSchema.safeParse({ ...minimal, replaceWidgetTypes: ["say-play"] });
    expect(result.success).toBe(false);
  });

  it("accepts every managed widget type", () => {
    const result = configFileSchema.safeParse({
      ...minimal,
      replaceWidgetTypes: [
        "run-function",
        "send-to-flex",
        "set-variables",
        "run-subflow",
        "enqueue-call",
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts the three forms of environmentSuffix", () => {
    const result = configFileSchema.safeParse({
      ...minimal,
      functionServices: [
        { name: "a", environmentSuffix: "dev" },
        { name: "b", environmentSuffix: null },
        { name: "c", environmentSuffix: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a numeric environmentSuffix other than 0", () => {
    const result = configFileSchema.safeParse({
      ...minimal,
      functionServices: [{ name: "a", environmentSuffix: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("requires flows to be present", () => {
    expect(configFileSchema.safeParse({}).success).toBe(false);
  });
});

describe("flow definition schema", () => {
  const valid = {
    description: "flow",
    initial_state: "Trigger",
    flags: { allow_concurrent_calls: true },
    states: [{ name: "Trigger", type: "trigger", properties: {}, transitions: [] }],
  };

  it("accepts a minimal definition", () => {
    expect(flowDefinitionSchema.safeParse(valid).success).toBe(true);
  });

  it("preserves unknown top-level and state keys", () => {
    const parsed = flowDefinitionSchema.parse({
      ...valid,
      unknownTopLevel: "kept",
      states: [{ ...valid.states[0], unknownState: "kept" }],
    });

    expect(parsed).toMatchObject({ unknownTopLevel: "kept" });
    expect(parsed.states[0]).toMatchObject({ unknownState: "kept" });
  });

  it("defaults a missing transitions array", () => {
    const parsed = flowDefinitionSchema.parse({
      ...valid,
      states: [{ name: "Trigger", type: "trigger", properties: {} }],
    });
    expect(parsed.states[0].transitions).toEqual([]);
  });

  it("requires initial_state to be Trigger", () => {
    expect(flowDefinitionSchema.safeParse({ ...valid, initial_state: "Start" }).success).toBe(false);
  });

  it("requires allow_concurrent_calls to be enabled", () => {
    const result = flowDefinitionSchema.safeParse({
      ...valid,
      flags: { allow_concurrent_calls: false },
    });
    expect(result.success).toBe(false);
  });

  it("requires a value on conditions that compare something", () => {
    const result = flowDefinitionSchema.safeParse({
      ...valid,
      states: [
        {
          name: "Split",
          type: "split-based-on",
          properties: {},
          transitions: [
            {
              event: "match",
              conditions: [{ friendly_name: "equals", arguments: ["x"], type: "equal_to" }],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("allows is_blank conditions to omit a value", () => {
    const result = flowDefinitionSchema.safeParse({
      ...valid,
      states: [
        {
          name: "Split",
          type: "split-based-on",
          properties: {},
          transitions: [
            {
              event: "match",
              conditions: [{ friendly_name: "blank", arguments: ["x"], type: "is_blank" }],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
