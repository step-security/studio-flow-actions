import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";

/**
 * Bundles each action with ncc.
 *
 * Run with `node build.mts` — Node strips the types directly, so there is no
 * separate compile step. This needs Node 24 (see `engines` in package.json),
 * which is also the runtime the actions declare.
 */
const ACTIONS = ["check", "validate", "deploy", "sync"] as const;

/**
 * ncc reports success even when it cannot resolve an import — it substitutes a
 * stub that throws MODULE_NOT_FOUND at runtime instead. Every bundle is scanned
 * for that stub so a broken build fails here rather than on a runner.
 */
function assertNoMissingModules(bundlePath: string): void {
  const bundle = readFileSync(bundlePath, "utf8");
  if (!bundle.includes("webpackMissingModule")) return;

  const named = [...bundle.matchAll(/Cannot find module '([^']+)'/g)].map((match) => match[1]);
  const detail = named.length ? `: ${[...new Set(named)].join(", ")}` : "";
  throw new Error(`${bundlePath} contains unresolved imports${detail}`);
}

let built = 0;
for (const action of ACTIONS) {
  const entry = `${action}/main.ts`;
  if (!existsSync(entry)) {
    console.warn(`Skipping ${action}: ${entry} not found`);
    continue;
  }

  console.log(`Building ${action}...`);
  // Minified: the Twilio SDK dominates these bundles, and they are committed.
  execSync(`node_modules/.bin/ncc build ${entry} -o ${action}/dist --minify`, { stdio: "inherit" });
  assertNoMissingModules(`${action}/dist/index.js`);
  built += 1;
}

console.log(`\nBuilt ${built} action bundle${built === 1 ? "" : "s"}, all imports resolved.`);
