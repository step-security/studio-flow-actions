import { loadConfiguration } from "../_lib/config/load";
import { buildCommitMessage, prepareFlows, publishFlow } from "../_lib/pipeline/apply";
import { loadResources } from "../_lib/pipeline/load-resources";
import { runtime } from "../_lib/runtime";
import { validateSubscription } from "../_lib/subscription";
import { createTwilioClient } from "../_lib/twilio-client";

/**
 * Publishes the repository's flow definitions to the target account.
 *
 * Nothing is published unless every flow prepares cleanly. A partial deploy is
 * the worst outcome here — a parent flow pointing at a subflow that was never
 * written leaves the account in a state neither revision describes.
 */
export async function run(): Promise<void> {
  await validateSubscription();

  const config = await loadConfiguration();
  const client = createTwilioClient();
  const { resources } = await loadResources(config, client);

  const { prepared, ok } = await prepareFlows(config, resources);
  if (!ok) runtime.fail("Deployment aborted: one or more flows failed validation.");

  const commitMessage = buildCommitMessage();

  for (const entry of prepared) {
    await publishFlow(entry, resources, commitMessage);
    runtime.info(`Published '${entry.flow.name}' (${entry.changes.length} replacements)`);
    runtime.addSummarySection(`Flow \`${entry.flow.name}\``, entry.changes);
  }

  await runtime.flushSummary();
}
