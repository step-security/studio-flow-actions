import type { ConfigFile } from "../../config/schema";
import { configFileSchema } from "../../config/schema";
import type { FlowDefinition, FlowState } from "../../studio/flow-schema";
import type { FunctionCatalog, FunctionServiceInfo, TwilioResources } from "../../studio/resources";

/** Builds a flow definition around the given states. */
export function flowWith(...states: FlowState[]): FlowDefinition {
  return {
    description: "test flow",
    initial_state: "Trigger",
    flags: { allow_concurrent_calls: true },
    states: [
      {
        name: "Trigger",
        type: "trigger",
        properties: {},
        transitions: [{ event: "incomingCall", next: states[0]?.name }],
      },
      ...states,
    ],
  } as FlowDefinition;
}

export function state(name: string, type: string, properties: Record<string, unknown>): FlowState {
  return { name, type, properties, transitions: [] } as FlowState;
}

/** Parses a partial config through the real schema so defaults are applied. */
export function configOf(partial: Record<string, unknown>): ConfigFile {
  return configFileSchema.parse({ flows: [], ...partial });
}

export function functionCatalogOf(services: FunctionServiceInfo[]): FunctionCatalog {
  return {
    find: (name) => services.find((service) => service.uniqueName === name),
  };
}

export function resourcesOf(overrides: Partial<TwilioResources> = {}): TwilioResources {
  return {
    client: {} as TwilioResources["client"],
    functions: functionCatalogOf([]),
    channelSids: {},
    workflowSids: {},
    flowSids: {},
    ...overrides,
  };
}
