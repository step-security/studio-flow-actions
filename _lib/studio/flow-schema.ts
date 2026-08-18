import { z } from "zod";

/**
 * Condition types that carry no comparison value. Every other type must supply
 * one, which the refinement below enforces.
 */
export const VALUELESS_CONDITION_TYPES = ["is_blank", "is_not_blank"] as const;

const conditionSchema = z
  .object({
    friendly_name: z.string(),
    arguments: z.array(z.string()),
    type: z.string(),
    value: z.string().optional(),
  })
  .superRefine((condition, ctx) => {
    const needsValue = !VALUELESS_CONDITION_TYPES.includes(condition.type as never);
    if (needsValue && condition.value === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `A value is required for condition type '${condition.type}'.`,
      });
    }
  });

export const transitionSchema = z.object({
  event: z.string(),
  next: z.string().optional(),
  conditions: z.array(conditionSchema).optional(),
});

/**
 * The Studio flow envelope. Unknown keys pass through untouched throughout, so
 * round-tripping a definition never drops fields this project does not model —
 * important because these definitions are written back to Twilio verbatim.
 */
export const flowDefinitionSchema = z
  .object({
    description: z.string(),
    states: z.array(
      z
        .object({
          name: z.string(),
          type: z.string(),
          transitions: z.array(transitionSchema).default([]),
          properties: z.record(z.unknown()),
        })
        .passthrough()
    ),
    initial_state: z.literal("Trigger"),
    flags: z
      .object({
        allow_concurrent_calls: z.literal(true),
      })
      .passthrough(),
  })
  .passthrough();

export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;
export type FlowState = FlowDefinition["states"][number];
export type FlowTransition = z.infer<typeof transitionSchema>;

/** Parses a flow definition, reporting the failure against a named source. */
export function parseFlowDefinition(source: string, label: string): FlowDefinition {
  const result = flowDefinitionSchema.safeParse(JSON.parse(source));
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `  [${issue.path.join(".") || "root"}] ${issue.message}`)
    .join("\n");
  throw new Error(`'${label}' is not a valid Studio Flow definition:\n${issues}`);
}
