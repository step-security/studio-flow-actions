import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { runtime } from "../runtime";
import { createGithubService } from "../services/github";
import { checkRepositoryPath } from "./paths";
import { ConfigFile, configFileSchema } from "./schema";

/** Matches $NAME shell-style references. */
const SHELL_VARIABLE = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

/**
 * Reads a repository file, falling back to the GitHub API when it is not on
 * disk. That fallback exists so a workflow can run without a full checkout: the
 * file is fetched at the commit under test and cached locally, which later steps
 * (and the sync writer) then treat as an ordinary working-tree file.
 */
export async function readRepositoryFile(path: string): Promise<string> {
  if (existsSync(path)) return readFileSync(path, "utf8");

  if (!runtime.isRunner) {
    runtime.fail(`File '${path}' could not be found. Did you forget to check it out?`);
  }

  const github = createGithubService(runtime.requireInput("TOKEN", true));
  const content = await github.readFile(path, process.env.GITHUB_SHA!);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return content;
}

/** As readRepositoryFile, but yields null instead of failing when absent. */
export async function tryReadRepositoryFile(path: string): Promise<string | null> {
  try {
    return await readRepositoryFile(path);
  } catch {
    return null;
  }
}

/**
 * Substitutes $VAR references from the environment. Unset variables collapse to
 * an empty string, matching how a shell would expand them.
 */
function expandShellVariables(source: string): string {
  return source.replace(SHELL_VARIABLE, (_match, name: string) => {
    const value = process.env[name];
    runtime.debug(`Substituting shell variable $${name}`);
    return value ?? "";
  });
}

/**
 * Loads and validates the configuration file named by the CONFIG_PATH input.
 *
 * Shell expansion is opt-in via `enableShellVariables`, which means the file has
 * to be parsed twice: once to read that flag, then again after expansion.
 */
export async function loadConfiguration(): Promise<ConfigFile> {
  const requested = runtime.requireInput("CONFIG_PATH");
  const checked = checkRepositoryPath(requested);
  if (!checked.ok) runtime.fail(`CONFIG_PATH ${checked.reason}.`);
  const configPath = checked.path;

  let raw = await readRepositoryFile(configPath);

  let firstPass: unknown;
  try {
    firstPass = JSON.parse(raw);
  } catch (error) {
    runtime.fail(`Configuration file '${configPath}' is not valid JSON: ${(error as Error).message}`);
  }

  if ((firstPass as { enableShellVariables?: unknown })?.enableShellVariables === true) {
    raw = expandShellVariables(raw);
  }

  const parsed = configFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  [${issue.path.join(".") || "root"}] ${issue.message}`)
      .join("\n");
    runtime.fail(`Configuration file '${configPath}' is invalid:\n${issues}`);
  }

  return parsed.data;
}
