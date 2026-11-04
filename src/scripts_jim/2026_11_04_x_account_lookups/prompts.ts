/* Writes the X account lookup prompt of the first N creators still waiting,
 * one folder per creator, so a test batch can run with the real prompt.
 * Usage: bun run src/scripts_jim/2026_11_04_x_account_lookups/prompts.ts <out dir> <n> */

import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { xAccountPrompt } from "../../claude-notes/prompts";
import { creatorsToLookUp } from "../../claude-notes/xAccounts";

const [outDir, count] = process.argv.slice(2);
const creators = await creatorsToLookUp();
console.error(`${creators.length} creators are waiting for a lookup`);
for (const creator of creators.slice(0, Number(count))) {
  const runDir = path.join(path.resolve(outDir), creator.slug);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "prompt.md"), xAccountPrompt({ creator, runDir }));
  console.log(creator.slug);
}
