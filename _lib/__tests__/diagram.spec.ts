import { renderFlowDiagram, renderFlowDiff } from "../studio/diagram";
import type { FlowDefinition, FlowState } from "../studio/flow-schema";

function flow(states: FlowState[]): FlowDefinition {
  return {
    description: "flow",
    initial_state: "Trigger",
    flags: { allow_concurrent_calls: true },
    states,
  } as FlowDefinition;
}

function node(
  name: string,
  type: string,
  next?: string,
  properties: Record<string, unknown> = {}
): FlowState {
  return {
    name,
    type,
    properties,
    transitions: next ? [{ event: "next", next }] : [],
  } as FlowState;
}

const trigger = (next: string) => node("Trigger", "trigger", next);

describe("rendering a whole flow", () => {
  it("emits a flowchart containing every connection", () => {
    const diagram = renderFlowDiagram(
      flow([trigger("Greeting"), node("Greeting", "say-play", "Menu"), node("Menu", "gather", undefined)])
    );

    expect(diagram).not.toBeNull();
    expect(diagram!.content.startsWith("flowchart TD")).toBe(true);
    expect(diagram!.edgeCount).toBe(2);
    expect(diagram!.nodeCount).toBe(3);
  });

  it("returns null for a flow with no states", () => {
    expect(renderFlowDiagram(flow([]))).toBeNull();
  });

  it("includes a state that has no connections at all", () => {
    const diagram = renderFlowDiagram(flow([node("Orphan", "say-play")]));
    expect(diagram!.nodeCount).toBe(1);
    expect(diagram!.edgeCount).toBe(0);
  });

  it("gives subflow and split widgets distinct shapes", () => {
    const diagram = renderFlowDiagram(
      flow([trigger("Split"), node("Split", "split-based-on", "Sub"), node("Sub", "run-subflow")])
    );
    // {{ }} marks a split, [[ ]] marks a subflow.
    expect(diagram!.content).toContain("{{");
    expect(diagram!.content).toContain("[[");
  });

  it("labels edges with the event and any conditions", () => {
    const withCondition = {
      name: "Split",
      type: "split-based-on",
      properties: {},
      transitions: [
        {
          event: "match",
          next: "Done",
          conditions: [{ friendly_name: "is one", arguments: ["x"], type: "equal_to", value: "1" }],
        },
      ],
    } as FlowState;

    const diagram = renderFlowDiagram(flow([withCondition, node("Done", "say-play")]));
    expect(diagram!.content).toContain("match: equal_to 1");
  });

  it("escapes quotes so the label cannot break the node", () => {
    const diagram = renderFlowDiagram(flow([node('Say "hi"', "say-play")]));
    expect(diagram!.content).not.toContain('"Say "hi"');
    expect(diagram!.content).toContain("#quot;");
  });
});

describe("rendering a diff", () => {
  const before = flow([trigger("Greeting"), node("Greeting", "say-play", "Menu"), node("Menu", "gather")]);

  it("returns null when nothing changed and nothing is adjacent", () => {
    expect(renderFlowDiff(before, before)).toBeNull();
  });

  it("marks an added widget and styles it", () => {
    const after = flow([
      trigger("Greeting"),
      node("Greeting", "say-play", "Menu"),
      node("Menu", "gather", "Extra"),
      node("Extra", "say-play"),
    ]);

    const diagram = renderFlowDiff(before, after);
    expect(diagram!.content).toContain("classDef add");
    expect(diagram!.content).toContain(":::add");
  });

  it("marks a widget whose properties changed", () => {
    const after = flow([
      trigger("Greeting"),
      node("Greeting", "say-play", "Menu", { say: "new copy" }),
      node("Menu", "gather"),
    ]);

    const diagram = renderFlowDiff(before, after);
    expect(diagram!.content).toContain("classDef chg");
  });

  it("ignores a widget that only moved on the canvas", () => {
    const positioned = flow([
      trigger("Greeting"),
      node("Greeting", "say-play", "Menu", { offset: { x: 10, y: 10 } }),
      node("Menu", "gather"),
    ]);
    const moved = flow([
      trigger("Greeting"),
      node("Greeting", "say-play", "Menu", { offset: { x: 800, y: 400 } }),
      node("Menu", "gather"),
    ]);

    expect(renderFlowDiff(positioned, moved)).toBeNull();
  });

  it("marks a removed widget and severs its edge", () => {
    const after = flow([trigger("Greeting"), node("Greeting", "say-play", "Menu"), node("Menu", "gather")]);
    const withExtra = flow([...after.states, node("Extra", "say-play")]);

    const diagram = renderFlowDiff(withExtra, after);
    expect(diagram!.content).toContain("classDef del");
  });

  it("draws a severed edge when a connection disappears", () => {
    const after = flow([trigger("Greeting"), node("Greeting", "say-play"), node("Menu", "gather")]);
    const diagram = renderFlowDiff(before, after);
    // -.-x is the severed-edge form.
    expect(diagram!.content).toContain("-.-x");
  });

  it("keeps node ids short regardless of widget name length", () => {
    const longName = "A".repeat(120);
    const diagram = renderFlowDiagram(flow([node(longName, "say-play", "Second"), node("Second", "gather")]));

    // The long name appears once, in the label, not as an identifier.
    expect(diagram!.content.split(longName).length - 1).toBe(1);
  });
});
