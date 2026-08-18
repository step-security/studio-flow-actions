import { basename, dirname } from "path";
import { mkdirSync, writeFileSync } from "fs";
import colors from "ansi-colors";
import { loadConfiguration, tryReadRepositoryFile } from "../_lib/config/load";
import { backfillDeployProperties } from "../_lib/pipeline/backfill";
import { runtime } from "../_lib/runtime";
import { createFlowDirectory } from "../_lib/services/flows";
import { createGithubService, FileToCommit } from "../_lib/services/github";
import { readTaskrouterMaps } from "../_lib/services/taskrouter";
import { renderFlowDiagram, renderFlowDiff } from "../_lib/studio/diagram";
import { renderDiagramSvg } from "../_lib/studio/diagram-svg";
import { FlowDefinition, parseFlowDefinition } from "../_lib/studio/flow-schema";
import { inspectManagedWidgets } from "../_lib/studio/managed-widgets";
import { validateSubscription } from "../_lib/subscription";
import { createTwilioClient } from "../_lib/twilio-client";

/** GitHub rejects pull request bodies beyond 65,536 characters. */
const PR_BODY_LIMIT = 60000;
/** Diagrams past this size are unreadable and slow to render. */
const MAX_DIAGRAM_EDGES = 500;

interface SyncedFlow {
  path: string;
  content: string;
  friendlyName: string;
  sid: string;
  revision: number;
  adjustments: string[];
  before: FlowDefinition | null;
  after: FlowDefinition;
}

/**
 * Orders states for a stable on-disk representation: the trigger first, then
 * everything else by name.
 *
 * Studio returns states in editor order, which shifts whenever someone moves a
 * widget. Without a canonical order every sync produces a diff that is entirely
 * noise.
 */
function sortStates(definition: FlowDefinition): void {
  const trigger = definition.states.filter((state) => state.type === "trigger");
  const rest = definition.states
    .filter((state) => state.type !== "trigger")
    .sort((first, second) => first.name.localeCompare(second.name));

  definition.states = [...trigger, ...rest];
}

/** Renders the per-flow section of the pull request body. */
function describeFlow(flow: SyncedFlow, bodySoFar: number): string {
  const lines = [
    `- \`${flow.path}\``,
    `\t- **Friendly Name**: ${flow.friendlyName}`,
    `\t- **Sid**: ${flow.sid}`,
    `\t- **Revision**: ${flow.revision}`,
  ];

  if (flow.adjustments.length) {
    lines.push(`\t- **Adjustments**:\n\t\t${flow.adjustments.join("\n\t\t")}`);
  }

  let section = lines.join("\n");

  const diagram = renderFlowDiff(flow.before ?? flow.after, flow.after);
  if (!diagram) return section;

  if (diagram.edgeCount > MAX_DIAGRAM_EDGES) {
    section += "\n*Change preview omitted: too many connections to render.*";
  } else if (bodySoFar + section.length + diagram.content.length > PR_BODY_LIMIT) {
    section += "\n*Change preview omitted: pull request body size limit reached.*";
  } else {
    section += `\n\`\`\`mermaid\n${diagram.content}\n\`\`\``;
  }

  return section;
}

/**
 * Pulls the live flow definitions from Twilio into the repository and opens a
 * pull request with the result.
 *
 * This is the reverse direction from deploy: it exists so work done in the Studio
 * console can be captured in version control rather than lost on the next
 * deployment.
 */
export async function run(): Promise<void> {
  await validateSubscription();

  const config = await loadConfiguration();
  const client = createTwilioClient();
  const flows = await createFlowDirectory(client);

  const shouldBackfill = runtime.readFlag("ADD_MISSING_DEPLOY_PROPERTIES");
  const skipCheck = runtime.readFlag("DISABLE_CHECK");

  // Only read Taskrouter when the backfill actually needs the SID maps.
  const taskrouter = shouldBackfill
    ? await readTaskrouterMaps(client)
    : { channelSids: {}, workflowSids: {} };

  const synced: SyncedFlow[] = [];
  let ok = true;

  for (const entry of config.flows) {
    runtime.beginGroup(entry.name);
    try {
      const existing = await tryReadRepositoryFile(entry.path);
      const before = existing ? parseFlowDefinition(existing, entry.path) : null;

      const instance = entry.sid ? flows.requireBySid(entry.sid) : flows.requireByName(entry.name);
      const definition = parseFlowDefinition(
        JSON.stringify(await flows.fetchDefinition(instance.sid)),
        `${instance.friendlyName} (${instance.sid})`
      );

      const adjustments = shouldBackfill
        ? backfillDeployProperties(definition, {
            config,
            taskrouter,
            flows,
            flowName: instance.friendlyName,
          })
        : [];

      sortStates(definition);
      const content = `${JSON.stringify(definition, undefined, 2)}\n`;

      if (!skipCheck && !inspectManagedWidgets(definition, config).ok) {
        ok = false;
        continue;
      }

      mkdirSync(dirname(entry.path), { recursive: true });
      writeFileSync(entry.path, content, "utf8");

      synced.push({
        path: entry.path,
        content,
        friendlyName: instance.friendlyName,
        sid: instance.sid,
        revision: instance.revision,
        adjustments,
        before,
        after: definition,
      });

      runtime.info(
        `Updated ${colors.blue(entry.path)} from ${colors.yellow(instance.friendlyName)}/` +
          `${colors.magenta(instance.sid)} revision ${colors.cyan(String(instance.revision))}`
      );
    } finally {
      runtime.endGroup();
    }
  }

  if (!ok) runtime.fail("Check failed.");

  // Off a runner the files are simply left in the working tree.
  if (!process.env.GITHUB_REPOSITORY) return;
  if (!synced.length) {
    runtime.info("No flows were synced; nothing to commit.");
    return;
  }

  await raisePullRequest(synced);
}

/** Commits the synced files, with optional diagrams, and opens a pull request. */
async function raisePullRequest(synced: SyncedFlow[]): Promise<void> {
  const runNumber = process.env.GITHUB_RUN_NUMBER ?? "0";
  const branch = `studio-flow/update-run-${runNumber}`;

  const github = createGithubService(runtime.requireInput("TOKEN", true));
  const files: FileToCommit[] = synced.map((flow) => ({ path: flow.path, content: flow.content }));

  const diagramPath = runtime.readInput("SAVE_DIAGRAMS_TO_PATH");
  if (diagramPath) {
    runtime.info("Generating diagrams...");
    for (const flow of synced) {
      const previous = flow.before ? renderFlowDiagram(flow.before) : null;
      const current = renderFlowDiagram(flow.after);

      // Skip flows whose diagram is unchanged, so the commit stays minimal.
      if (!current || current.content === previous?.content) continue;

      files.push({
        path: `${diagramPath}/${basename(flow.path, ".json")}.svg`,
        content: await renderDiagramSvg(current.content),
      });
    }
  }

  await github.commitToNewBranch(
    files,
    branch,
    `auto: Sync studio flow definitions (${runNumber})`
  );

  let body = "";
  for (const flow of synced) {
    body = `${body}\n${describeFlow(flow, body.length)}`;
  }

  await github.openPullRequest(branch, `Sync Flow Files (Run ${runNumber})`, body);
}
