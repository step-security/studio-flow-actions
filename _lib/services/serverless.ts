import type { Twilio } from "twilio";
import type { ServiceInstance } from "twilio/lib/rest/serverless/v1/service";
import type { FunctionServiceEntry } from "../config/schema";
import { runtime } from "../runtime";
import { matchesServiceName } from "../studio/function-url";
import type { FunctionCatalog, FunctionServiceInfo } from "../studio/resources";

/** Entry in a build's function version list. */
interface BuildFunctionVersion {
  sid: string;
  path: string;
}

/**
 * Reads the function paths currently live in one service environment.
 *
 * The live set comes from the build the environment is *deployed to* rather than
 * the service's function list, so a function that exists but was never deployed
 * is correctly treated as unavailable.
 */
async function readServiceEnvironment(
  service: ServiceInstance,
  environmentSuffix: string | null | 0
): Promise<FunctionServiceInfo | undefined> {
  runtime.debug(`Serverless: listing environments for ${service.uniqueName}`);
  const environments = await service.environments().list();

  const environment =
    environmentSuffix === 0
      ? environments[0]
      : environments.find((candidate) => candidate.domainSuffix === environmentSuffix);

  if (!environment) {
    const wanted = environmentSuffix === 0 ? "any" : `'${environmentSuffix}'`;
    runtime.warn(
      `Service '${service.uniqueName}' has no environment with domain suffix ${wanted}. Skipping.`
    );
    return undefined;
  }

  if (!environment.buildSid) {
    runtime.warn(
      `Environment '${service.uniqueName}/${environment.domainSuffix}' has no deployed build. Skipping.`
    );
    return undefined;
  }

  runtime.debug(`Serverless: fetching build ${environment.buildSid}`);
  const build = await service.builds().get(environment.buildSid).fetch();
  const versions = (build.functionVersions ?? []) as BuildFunctionVersion[];

  return {
    uniqueName: service.uniqueName,
    serviceSid: service.sid,
    environmentSid: environment.sid,
    domainName: environment.domainName,
    functions: Object.fromEntries(versions.map((version) => [version.path, version.sid])),
  };
}

/**
 * Resolves the Functions services named in the configuration file.
 *
 * A configured service that is not deployed produces a warning rather than a
 * failure — the widget validators report it precisely, against the URL that
 * needed it, which is a more useful error than one raised from here.
 */
export async function createFunctionCatalog(
  client: Twilio,
  entries: FunctionServiceEntry[]
): Promise<FunctionCatalog> {
  const resolved: Array<{ entry: FunctionServiceEntry; info: FunctionServiceInfo }> = [];

  if (entries.length) {
    runtime.debug("Serverless: listing services");
    const deployed = await client.serverless.v1.services.list();

    for (const entry of entries) {
      const service = deployed.find((candidate) =>
        matchesServiceName(entry, candidate.uniqueName)
      );

      if (!service) {
        runtime.warn(`No deployed Functions service matches '${entry.name}'.`);
        continue;
      }

      const info = await readServiceEnvironment(service, entry.environmentSuffix);
      if (info) resolved.push({ entry, info });
    }
  }

  return {
    find: (serviceName) =>
      resolved.find(({ entry }) => matchesServiceName(entry, serviceName))?.info,
  };
}
