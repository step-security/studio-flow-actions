import { isAbsolute } from "path";

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Normalises a repository-relative path, or reports why it is unacceptable.
 *
 * Flow paths inside the configuration file are constrained by the schema; this
 * exists to apply the same rule to CONFIG_PATH, which arrives as an action input
 * and would otherwise be free to point anywhere on the runner.
 *
 * Reporting the reason rather than throwing keeps this free of any dependency on
 * the runtime, so it stays trivially testable.
 */
export function checkRepositoryPath(input: string): PathCheck {
  const path = input.startsWith("./") ? input.slice(2) : input;

  if (isAbsolute(path)) {
    return { ok: false, reason: `must be a path inside the repository, but '${input}' is absolute` };
  }
  if (path === ".." || path.split("/").includes("..")) {
    return {
      ok: false,
      reason: `must be a path inside the repository, but '${input}' traverses upwards`,
    };
  }

  return { ok: true, path };
}
