import type { Twilio } from "twilio";

/** A deployed Functions service, resolved down to what widget rewriting needs. */
export interface FunctionServiceInfo {
  uniqueName: string;
  serviceSid: string;
  environmentSid: string;
  domainName: string;
  /** Function path ("/foo/bar") to its version SID. */
  functions: Record<string, string>;
}

/** Lookup over the Functions services named in the configuration file. */
export interface FunctionCatalog {
  /** Resolves a service by unique name, honouring pattern entries. */
  find(serviceName: string): FunctionServiceInfo | undefined;
}

/**
 * Everything read from the Twilio account up front, so widget rewriting is a
 * pure in-memory operation over these maps rather than a series of API calls.
 */
export interface TwilioResources {
  client: Twilio;
  functions: FunctionCatalog;
  /** TaskChannel uniqueName to SID. */
  channelSids: Record<string, string>;
  /** Workflow friendlyName to SID, merged with any configured overrides. */
  workflowSids: Record<string, string>;
  /** Studio flow friendlyName to SID, merged with any configured overrides. */
  flowSids: Record<string, string>;
}
