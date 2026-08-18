import colors from "ansi-colors";
import { runtime } from "../runtime";
import type { ConfigFile } from "../config/schema";
import type { FlowDefinition, FlowState } from "./flow-schema";
import type { TwilioResources } from "./resources";
import { ManagedWidget, WIDGET_HANDLERS, WidgetIssue } from "./widget-registry";
import { isManagedWidgetType } from "./widget-types";

export interface InspectionResult {
  /** Widgets that passed both structural and semantic checks. */
  widgets: ManagedWidget[];
  /** True when every managed widget in the flow was accepted. */
  ok: boolean;
}

/** Renders one widget's problems as an indented block under its name. */
function reportIssues(widgetName: string, issues: WidgetIssue[]): void {
  const lines = issues.map((issue) => {
    const location = issue.path.length ? issue.path.join(".") : "widget";
    return `    ${colors.yellow(`[${location}]`)} ${issue.message}`;
  });
  runtime.error(`- ${widgetName}\n${lines.join("\n")}`);
}

/**
 * Validates every managed widget in a flow and returns the ones that are usable.
 *
 * Structural validation comes from each handler's schema; semantic validation
 * comes from its `inspect`. Passing `resources` enables the checks that need to
 * see the Twilio account — without it, only offline rules run, which is what the
 * check action does on a pull request.
 *
 * All widgets are examined before returning so a single run reports every
 * problem rather than stopping at the first.
 */
export function inspectManagedWidgets(
  flow: FlowDefinition,
  config: ConfigFile,
  resources?: TwilioResources
): InspectionResult {
  const managed = flow.states.filter((state: FlowState) => isManagedWidgetType(state.type));

  const widgets: ManagedWidget[] = [];
  let ok = true;

  for (const state of managed) {
    const handler = WIDGET_HANDLERS[state.type as keyof typeof WIDGET_HANDLERS];

    const parsed = handler.schema.safeParse(state);
    if (!parsed.success) {
      reportIssues(
        state.name,
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String),
          message: issue.message,
        }))
      );
      ok = false;
      continue;
    }

    const issues = handler.inspect(parsed.data, config, resources);
    if (issues.length) {
      reportIssues(state.name, issues);
      ok = false;
      continue;
    }

    widgets.push(parsed.data as ManagedWidget);
  }

  return { widgets, ok };
}
