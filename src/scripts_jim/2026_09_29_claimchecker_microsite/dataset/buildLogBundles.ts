/** Packs the full logs of the checks into one file per eval run, `artifact/logs/<folder>.json`, because the page may hold at most 511 files and there is one log per check. The page loads a bundle the first time a log of that run is opened. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { LOGS_DIR } from "../runStore";

const BUNDLES_DIR = join(import.meta.dir, "artifact", "logs");
mkdirSync(BUNDLES_DIR, { recursive: true });

for (const folder of readdirSync(LOGS_DIR, { withFileTypes: true }).filter((f) => f.isDirectory() && f.name.startsWith("eval-")).map((f) => f.name)) {
  const bundle: Record<string, unknown> = {};
  for (const file of readdirSync(join(LOGS_DIR, folder)).filter((f) => f.endsWith(".json"))) {
    bundle[file] = JSON.parse(readFileSync(join(LOGS_DIR, folder, file), "utf8")).logs;
  }
  writeFileSync(join(BUNDLES_DIR, `${folder}.json`), JSON.stringify(bundle));
  console.log(`${folder}: ${Object.keys(bundle).length} logs`);
}
