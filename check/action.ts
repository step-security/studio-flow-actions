import { loadConfiguration, readRepositoryFile } from "../_lib/config/load";
import { runtime } from "../_lib/runtime";
import { parseFlowDefinition } from "../_lib/studio/flow-schema";
import { inspectManagedWidgets } from "../_lib/studio/managed-widgets";
import { validateSubscription } from "../_lib/subscription";

/**
 * Offline validation of the flow definitions in the repository.
 *
 * No Twilio credentials are involved, so this is the check to run on a pull
 * request from a fork: it catches malformed definitions and missing deploy
 * metadata without touching an account.
 */
export async function run(): Promise<void> {
  await validateSubscription();

  const config = await loadConfiguration();
  let ok = true;

  for (const flow of config.flows) {
    runtime.beginGroup(flow.name);
    try {
      const definition = parseFlowDefinition(await readRepositoryFile(flow.path), flow.path);
      const inspection = inspectManagedWidgets(definition, config);

      if (inspection.ok) runtime.info("Passed ✅", "green");
      else ok = false;
    } catch (error) {
      runtime.error((error as Error).message);
      ok = false;
    } finally {
      runtime.endGroup();
    }
  }

  if (!ok) runtime.fail("Check failed.");
}
