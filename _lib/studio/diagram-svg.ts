import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { runtime } from "../runtime";

const run = promisify(execFile);

const MERMAID_IMAGE = "ghcr.io/mermaid-js/mermaid-cli/mermaid-cli:11.4.2";
const WORK_DIR = "TEMP_DIAGRAMS";
const CONFIG_FILE = "mermaid-config.json";

/**
 * The default renderer gives up on the wide, shallow graphs Studio flows produce,
 * and the default limits are well below a real flow's size.
 */
const MERMAID_CONFIG = {
  maxEdges: 10000,
  maxTextSize: 500000,
  flowchart: { useMaxWidth: false, defaultRenderer: "elk" },
};

let prepared = false;

/** Pulls the renderer image and writes its config, once per process. */
async function prepareWorkspace(): Promise<void> {
  if (prepared) return;

  runtime.info("Pulling the Mermaid CLI image...");
  await run("docker", ["pull", MERMAID_IMAGE]);

  mkdirSync(WORK_DIR, { recursive: true });
  writeFileSync(join(WORK_DIR, CONFIG_FILE), JSON.stringify(MERMAID_CONFIG), "utf8");
  prepared = true;
}

/**
 * Renders Mermaid source to SVG using the official CLI container.
 *
 * The container writes as its own user by default, which would leave files the
 * runner cannot read, so it runs as the current uid/gid. Arguments are passed as
 * an argv array rather than a shell string — the filenames are generated, but
 * building a shell command out of them invites quoting bugs for no benefit.
 */
export async function renderDiagramSvg(mermaidSource: string): Promise<string> {
  await prepareWorkspace();

  const name = randomUUID();
  const inputPath = join(WORK_DIR, name);
  const outputPath = join(WORK_DIR, `${name}.svg`);

  writeFileSync(inputPath, mermaidSource, "utf8");

  try {
    const { stdout, stderr } = await run("docker", [
      "run",
      "--rm",
      "-u",
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      "-v",
      `${process.cwd()}/${WORK_DIR}:/data`,
      MERMAID_IMAGE,
      "-i",
      name,
      "-o",
      `${name}.svg`,
      "--configFile",
      CONFIG_FILE,
    ]);

    if (stdout.trim()) runtime.debug(stdout.trim());
    if (stderr.trim()) runtime.debug(stderr.trim());

    return readFileSync(outputPath, "utf8");
  } finally {
    rmSync(inputPath, { force: true });
    rmSync(outputPath, { force: true });
  }
}
