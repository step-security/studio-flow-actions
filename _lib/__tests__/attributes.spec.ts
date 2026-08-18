import { readFlexRoutingNames, readQueueWorkflowName, withAttribute } from "../studio/attributes";

describe("reading routing names from an attributes blob", () => {
  it("reads both names when present", () => {
    expect(
      readFlexRoutingNames('{"workflowName":"Assign to Anyone","channelName":"voice"}')
    ).toEqual({ workflowName: "Assign to Anyone", channelName: "voice" });
  });

  it("tolerates whitespace around the separator", () => {
    expect(readFlexRoutingNames('{ "workflowName" :  "Sales Queue" }').workflowName).toBe(
      "Sales Queue"
    );
  });

  it("accepts names containing spaces and hyphens", () => {
    expect(readFlexRoutingNames('{"workflowName":"Out-of-Hours Queue"}').workflowName).toBe(
      "Out-of-Hours Queue"
    );
  });

  it("returns null for names that are absent", () => {
    expect(readFlexRoutingNames("{}")).toEqual({ workflowName: null, channelName: null });
  });

  it("finds the name even when unparseable template expressions surround it", () => {
    const attributes = '{"from":"{{trigger.call.From}}","workflowName":"Assign to Anyone"}';
    expect(readFlexRoutingNames(attributes).workflowName).toBe("Assign to Anyone");
  });

  it("reads the workflow name for enqueue-call task attributes", () => {
    expect(readQueueWorkflowName('{"workflowName":"Callback"}').workflowName).toBe("Callback");
  });
});

describe("inserting an attribute", () => {
  it("produces a single-property object from an empty one", () => {
    expect(withAttribute("{}", "workflowName", "Sales")).toBe('{"workflowName":"Sales"}');
  });

  it("treats a whitespace-only object as empty", () => {
    expect(withAttribute("{  }", "channelName", "voice")).toBe('{"channelName":"voice"}');
  });

  it("prepends to existing content without disturbing it", () => {
    expect(withAttribute('{"existing":"kept"}', "workflowName", "Sales")).toBe(
      '{"workflowName":"Sales","existing":"kept"}'
    );
  });

  it("leaves template expressions in the remainder untouched", () => {
    const before = '{"from":"{{trigger.call.From}}"}';
    expect(withAttribute(before, "channelName", "voice")).toBe(
      '{"channelName":"voice","from":"{{trigger.call.From}}"}'
    );
  });

  it("yields a blob that both writers and readers agree on", () => {
    const withWorkflow = withAttribute("{}", "workflowName", "Sales");
    const withBoth = withAttribute(withWorkflow, "channelName", "voice");

    expect(readFlexRoutingNames(withBoth)).toEqual({
      workflowName: "Sales",
      channelName: "voice",
    });
    expect(JSON.parse(withBoth)).toEqual({ workflowName: "Sales", channelName: "voice" });
  });
});
