/**
 * Task attributes are stored by Studio as a JSON *string* that frequently
 * contains Studio's own `{{ }}` template expressions. Those expressions are not
 * valid JSON, so the string cannot be parsed and re-serialised without
 * corrupting them. Everything here therefore works on the raw text.
 */

const WORKFLOW_NAME = /"workflowName"\s*:\s*"([\w\s-]+)"/;
const CHANNEL_NAME = /"channelName"\s*:\s*"([\w\s-]+)"/;

/** Reads the deploy-time hints a send-to-flex widget must carry. */
export function readFlexRoutingNames(attributes: string): {
  workflowName: string | null;
  channelName: string | null;
} {
  return {
    workflowName: WORKFLOW_NAME.exec(attributes)?.[1] ?? null,
    channelName: CHANNEL_NAME.exec(attributes)?.[1] ?? null,
  };
}

/** Reads the deploy-time hint an enqueue-call widget must carry. */
export function readQueueWorkflowName(attributes: string): { workflowName: string | null } {
  return { workflowName: WORKFLOW_NAME.exec(attributes)?.[1] ?? null };
}

/**
 * Inserts a string property at the front of an attributes blob, preserving the
 * rest of the text exactly as written.
 */
export function withAttribute(attributes: string, key: string, value: string): string {
  const isEmptyObject = attributes.replace(/\s/g, "") === "{}";
  if (isEmptyObject) return `{"${key}":"${value}"}`;

  return `{"${key}":"${value}",${attributes.slice(attributes.indexOf("{") + 1)}`;
}
