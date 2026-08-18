import type { FunctionServiceEntry } from "../config/schema";

/**
 * Twilio Functions domains take the form
 * `<service>-<4 digits>[-<suffix>].twil.io`, e.g.
 * `my-api-1234-dev.twil.io/inbound/greeting`.
 */
export const FUNCTION_URL_PATTERN = /https:\/\/(\S+)-\d{4}(-(\S+))?\.twil\.io(\/\S*)/;

export interface FunctionUrlParts {
  serviceName: string;
  environmentSuffix: string | undefined;
  functionPath: string;
}

/** Splits a Functions URL into its parts, or null if it does not match. */
export function splitFunctionUrl(url: string): FunctionUrlParts | null {
  const match = FUNCTION_URL_PATTERN.exec(url);
  if (!match) return null;

  return {
    serviceName: match[1],
    environmentSuffix: match[3],
    functionPath: match[4],
  };
}

/**
 * Tests a configured service entry against a real service unique name. Entries
 * flagged as patterns are treated as regular expressions, which is how
 * library-installed services with generated names are matched.
 */
export function matchesServiceName(entry: FunctionServiceEntry, serviceName: string): boolean {
  if (entry.name === serviceName) return true;
  return Boolean(entry.pattern) && new RegExp(entry.name).test(serviceName);
}
