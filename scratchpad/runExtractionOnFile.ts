/**
 * One-off: run the everything-pipeline claim extraction on a local markdown
 * file (article/substack path), print every claim with its speculation flag,
 * then show what dropSpeculation keeps.
 *
 *   bun run scratchpad/runExtractionOnFile.ts scratchpad/ai-2040/01-about.md
 */

import "dotenv/config";
import * as fs from "fs";
import { dropSpeculation, extractClaims } from "../src/everything/extractClaims";
import type { FetchedContent } from "../src/everything/types";

const EXTRACTION_CONCURRENCY = 3;

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: runExtractionOnFile.ts <path.md>");
  const text = fs.readFileSync(path, "utf8");

  const content: FetchedContent = { kind: "substack", url: `file://${path}`, title: path, text };
  const claims = await extractClaims(content, EXTRACTION_CONCURRENCY);
  const kept = dropSpeculation(claims);

  claims.forEach((c, i) => {
    console.log(`\n[${i + 1}] ${c.speculation ? "🔮 SPECULATION" : "🌍 real"} · ${c.judgement}`);
    console.log(`    claim:   ${c.claim}`);
    console.log(`    context: ${c.context.slice(0, 160).replace(/\s+/g, " ")}${c.context.length > 160 ? "…" : ""}`);
  });

  // Stage 1 output (every claim, speculation flagged) and stage 2 output (filtered).
  const base = path.replace(/\.md$/, "");
  const extractedPath = `${base}.extracted.json`;
  const filteredPath = `${base}.filtered.json`;
  fs.writeFileSync(extractedPath, JSON.stringify(claims, null, 2));
  fs.writeFileSync(filteredPath, JSON.stringify(kept, null, 2));

  const speculation = claims.length - kept.length;
  console.log(
    `\n=== ${claims.length} claims · ${speculation} speculation dropped · ${kept.length} kept for the pipeline ===`,
  );
  console.log(`extracted → ${extractedPath}`);
  console.log(`filtered  → ${filteredPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
