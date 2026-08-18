import { loadConfiguration } from "../_lib/config/load";
import { AUTO_DEPLOY_PREFIX, prepareFlows } from "../_lib/pipeline/apply";
import { loadResources } from "../_lib/pipeline/load-resources";
import { runtime } from "../_lib/runtime";
import { validateSubscription } from "../_lib/subscription";
import { createTwilioClient } from "../_lib/twilio-client";
import type { FlowDirectory } from "../_lib/services/flows";
import type { ConfigFile } from "../_lib/config/schema";

/** Error shape Twilio returns from the flow validation endpoint. */
interface FlowValidationError {
  message: string;
  property_path: string;
}

/**
 * Twilio rejects a null flow_sid, which is the expected state for a subflow that
 * this run will create but has not created yet. That specific complaint is
 * therefore not a real failure.
 */
function isPendingSubflowError(error: FlowValidationError): boolean {
  return error.message.includes("null") && error.property_path.endsWith("/properties/flow_sid");
}

/**
 * Reports flows whose live revision was published by someone other than this
 * pipeline, which means a manual edit in the Studio console is about to be
 * overwritten.
 */
function findManuallyEditedFlows(config: ConfigFile, flows: FlowDirectory): string[] {
  const edited: string[] = [];

  for (const entry of config.flows) {
    const instance = entry.sid ? flows.findBySid(entry.sid) : flows.findByName(entry.name);
    if (!instance) continue;

    if (!instance.commitMessage?.startsWith(AUTO_DEPLOY_PREFIX)) {
      edited.push(`${entry.name} (${instance.sid})`);
    }
  }

  return edited;
}

/**
 * Dry run against a real account: resolves every SID and asks Twilio to validate
 * the resulting definitions, without publishing anything.
 */
export async function run(): Promise<void> {
  await validateSubscription();

  const config = await loadConfiguration();
  const client = createTwilioClient();
  const { resources, flows } = await loadResources(config, client);

  let ok = true;

  if (runtime.readFlag("VALIDATE_PREVIOUS_REVISION_USER")) {
    for (const flow of findManuallyEditedFlows(config, flows)) {
      runtime.error(`Flow ${flow} was last modified outside the deployment process.`);
      ok = false;
    }
  }

  const { prepared, ok: preparedOk } = await prepareFlows(config, resources);
  if (!preparedOk) ok = false;

  for (const entry of prepared) {
    runtime.beginGroup(entry.flow.name);
    runtime.addSummarySection(`Flow \`${entry.flow.name}\``, entry.changes);

    try {
      const validation = await client.studio.v2.flowValidate.update({
        friendlyName: entry.flow.name,
        status: "published",
        definition: entry.definition,
      });
      if (validation.valid) runtime.info("Passed ✅", "green");
    } catch (error) {
      const reported = (error as { details?: { errors?: FlowValidationError[] } }).details?.errors;

      if (!reported?.length) {
        runtime.error(`Validation failed for '${entry.flow.name}': ${(error as Error).message}`);
        ok = false;
      } else {
        for (const failure of reported) {
          if (isPendingSubflowError(failure)) continue;
          runtime.error(`Error - ${JSON.stringify(failure, undefined, 2)}`);
          ok = false;
        }
      }
    } finally {
      runtime.endGroup();
    }
  }

  await runtime.flushSummary();

  if (!ok) runtime.fail("Validation failed.");
}
