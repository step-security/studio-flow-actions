import axios from "axios";
import { existsSync, readFileSync } from "fs";
import { runtime } from "./runtime";

const UPSTREAM = "zingdevlimited/studio-flow-actions";
const DOCS_URL = "https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions";
const SUBSCRIPTION_API = "https://agent.api.stepsecurity.io/v1/github";
const REQUEST_TIMEOUT_MS = 3000;

const BOLD_CYAN = "\u001b[1;36m";
const GREEN = "\u001b[32m";
const CYAN = "\u001b[36m";
const BOLD_RED = "\u001b[1;31m";
const RED = "\u001b[31m";
const RESET = "\u001b[0m";

/** Reads repository visibility from the webhook payload on disk. */
function isRepositoryPublic(): boolean | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return undefined;

  try {
    const payload = JSON.parse(readFileSync(eventPath, "utf8"));
    const isPrivate = payload?.repository?.private;
    return typeof isPrivate === "boolean" ? !isPrivate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Prints the maintained-action banner and, for private repositories, confirms
 * the repository is entitled to use it. Network problems are non-fatal — only an
 * explicit 403 stops the run.
 */
export async function validateSubscription(): Promise<void> {
  const publicRepo = isRepositoryPublic();

  runtime.info("");
  runtime.info(`${BOLD_CYAN}StepSecurity Maintained Action${RESET}`);
  runtime.info(`Secure drop-in replacement for ${UPSTREAM}`);
  if (publicRepo === true) runtime.info(`${GREEN}✓ Free for public repositories${RESET}`);
  runtime.info(`${CYAN}Learn more:${RESET} ${DOCS_URL}`);
  runtime.info("");

  if (publicRepo === true) return;

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const body: Record<string, string> = { action: process.env.GITHUB_ACTION_REPOSITORY || "" };
  if (serverUrl !== "https://github.com") body.ghes_server = serverUrl;

  const endpoint = `${SUBSCRIPTION_API}/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`;

  try {
    await axios.post(endpoint, body, { timeout: REQUEST_TIMEOUT_MS });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      runtime.error(
        `${BOLD_RED}This action requires a StepSecurity subscription for private repositories.${RESET}`
      );
      runtime.error(`${RED}Learn how to enable a subscription: ${DOCS_URL}${RESET}`);
      process.exit(1);
    }
    runtime.info("Timeout or API not reachable. Continuing to next step.");
  }
}
