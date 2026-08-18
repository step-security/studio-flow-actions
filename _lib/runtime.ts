import * as core from "@actions/core";
import colors from "ansi-colors";

/**
 * These actions are designed to run both inside GitHub Actions and standalone
 * (a plain container, or an Azure Pipelines step). Everything that differs
 * between those two environments lives here, so the rest of the codebase never
 * has to branch on it.
 *
 * On a runner, inputs and secret masking go through @actions/core. Off it,
 * inputs come from the environment and masking is applied by this module before
 * anything reaches stdout.
 */
const onRunner = process.env.GITHUB_ACTIONS === "true";

/** Values registered as secret while running outside GitHub Actions. */
const localSecrets = new Set<string>();

export type MessageColor = "red" | "yellow" | "green" | "blue" | "cyan" | "magenta" | "gray";

function redact(message: string): string {
  let result = message;
  for (const secret of localSecrets) {
    if (secret) result = result.split(secret).join("***");
  }
  return result;
}

function containsSecret(value: string): boolean {
  for (const secret of localSecrets) {
    if (secret && value.includes(secret)) return true;
  }
  return false;
}

/** Rows accumulated for the run summary while off-runner, printed on flush. */
const localSummary: Array<{ heading: string; rows: ReadonlyArray<object> }> = [];

/**
 * Declared explicitly rather than inferred so that TypeScript propagates the
 * `never` return of `fail` through control-flow analysis. Without the annotation
 * the compiler cannot tell that code after a `fail` call is unreachable.
 */
export interface Runtime {
  readonly isRunner: boolean;
  hideSecret(value: string): void;
  requireInput(name: string, secret?: boolean): string;
  readInput(name: string): string | undefined;
  readFlag(name: string): boolean;
  info(message: string, color?: MessageColor): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  beginGroup(title: string): void;
  endGroup(): void;
  setOutput(name: string, value: string): void;
  addSummarySection(heading: string, rows: ReadonlyArray<object>): void;
  flushSummary(): Promise<void>;
  fail(message: string): never;
}

export const runtime: Runtime = {
  isRunner: onRunner,

  /** Registers a value so it is never printed in full. */
  hideSecret(value: string): void {
    if (!value) return;
    if (onRunner) core.setSecret(value);
    else localSecrets.add(value);
  },

  /**
   * Reads an action input, falling back to an environment variable of the same
   * name. Terminates the run when the value is absent.
   */
  requireInput(name: string, secret = false): string {
    const value = (onRunner ? core.getInput(name) : "") || process.env[name]?.trim() || "";

    if (!value) {
      runtime.fail(
        onRunner
          ? `Missing '${name}'. Provide it as an action input or an environment variable.`
          : `Missing environment variable '${name}'.`
      );
    }

    if (secret) runtime.hideSecret(value);
    return value;
  },

  /** Reads an optional input. Returns undefined when unset or blank. */
  readInput(name: string): string | undefined {
    const value = (onRunner ? core.getInput(name) : "") || process.env[name]?.trim() || "";
    return value || undefined;
  },

  /** True when an input is set to the string "true". */
  readFlag(name: string): boolean {
    return runtime.readInput(name) === "true";
  },

  info(message: string, color?: MessageColor): void {
    const text = color ? colors[color](message) : message;
    if (onRunner) core.info(text);
    else console.log(redact(text));
  },

  warn(message: string): void {
    if (onRunner) core.warning(message);
    else console.warn(colors.yellow(redact(message)));
  },

  error(message: string): void {
    if (onRunner) core.error(message);
    else console.error(colors.red(redact(message)));
  },

  debug(message: string): void {
    if (onRunner) {
      core.debug(message);
    } else if (process.env.DEBUG_MODE === "true") {
      console.log(colors.gray(`[DEBUG] ${redact(message)}`));
    }
  },

  beginGroup(title: string): void {
    if (onRunner) core.startGroup(title);
    else console.log(colors.gray(`===== ${title} =====`));
  },

  endGroup(): void {
    if (onRunner) core.endGroup();
    else console.log(colors.gray("====="));
  },

  setOutput(name: string, value: string): void {
    if (onRunner) {
      core.setOutput(name, value);
    } else if (containsSecret(value)) {
      console.warn(`Refusing to print output '${name}': it contains a masked value.`);
    } else {
      // Shell-consumable, so a caller can eval the output if they want it.
      console.log(`export ${name}=${value}`);
    }
  },

  /** Records a heading plus an optional table for the run summary. */
  addSummarySection(heading: string, rows: ReadonlyArray<object>): void {
    if (!onRunner) {
      localSummary.push({ heading, rows });
      return;
    }

    core.summary.addRaw(`## ${heading}`, true);
    if (!rows.length) return;

    const cells = rows as ReadonlyArray<Record<string, unknown>>;
    const columns = Object.keys(cells[0]);
    core.summary.addTable([
      columns.map((column) => ({ header: true, data: column })),
      ...cells.map((row) => columns.map((column) => String(row[column] ?? "Unknown"))),
    ]);
  },

  async flushSummary(): Promise<void> {
    if (onRunner) {
      await core.summary.write();
      return;
    }
    for (const section of localSummary) {
      console.log(`## ${colors.gray(section.heading)}`);
      if (section.rows.length) console.table(section.rows);
    }
    localSummary.length = 0;
  },

  /** Reports a fatal problem and ends the process. */
  fail(message: string): never {
    if (onRunner) {
      core.setFailed(message);
      process.exit(1);
    }
    console.error(colors.red(redact(message)));
    process.exit(1);
  },
};
