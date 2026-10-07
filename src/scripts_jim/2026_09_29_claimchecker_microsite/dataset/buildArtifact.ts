/**
 * Writes the HTML of the eval sets page: the template with dataset.json inlined.
 * The page is published as an artifact. Run buildDataset.ts first.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/buildArtifact.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { LAB_DIR } from "../runStore";

const DATASET_DIR = join(LAB_DIR, "dataset");
const template = readFileSync(join(DATASET_DIR, "artifact", "template.html"), "utf8");
const dataset = readFileSync(join(DATASET_DIR, "dataset.json"), "utf8");
// "</" inside the JSON would end the script element early.
const safeJson = dataset.replaceAll("</", "<\\/");
writeFileSync(join(DATASET_DIR, "artifact", "evalSets.html"), template.replace("/*DATA*/", () => safeJson));
console.log(`Wrote evalSets.html with ${JSON.parse(dataset).datapoints.length} datapoints`);
