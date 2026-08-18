/**
 * Widget types this project rewrites at deploy time. Kept in its own module so
 * both the configuration schema and the widget registry can reference it without
 * importing each other.
 */
export const MANAGED_WIDGET_TYPES = [
  "run-function",
  "send-to-flex",
  "set-variables",
  "run-subflow",
  "enqueue-call",
] as const;

export type ManagedWidgetType = (typeof MANAGED_WIDGET_TYPES)[number];

export function isManagedWidgetType(type: string): type is ManagedWidgetType {
  return (MANAGED_WIDGET_TYPES as readonly string[]).includes(type);
}
