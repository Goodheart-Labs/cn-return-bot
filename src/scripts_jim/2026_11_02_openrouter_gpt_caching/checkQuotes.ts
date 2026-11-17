/* GOO-688: are the source quotes of a harness run word for word on their
 * pages? Fetches each source with the pipeline's fetch ladder and looks for
 * the quote, with whitespace and curly quotes made uniform first.
 *
 * Usage: bun run src/scripts_jim/2026_11_02_openrouter_gpt_caching/checkQuotes.ts [run.json] */

import { readFileSync } from "fs";
import * as path from "path";
import { fetchWebPage } from "../../pipeline/tool-calling/tools";

const file = process.argv[2] ?? path.join(import.meta.dir, "out/e2e.json");
const record = JSON.parse(readFileSync(file, "utf8"));
const uniform = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

for (const draft of record.drafts) {
  for (const source of draft.sources) {
    const text = (await fetchWebPage(source.url)).content;
    console.log(`${uniform(text).includes(uniform(source.quote)) ? "FOUND  " : "MISSING"} ${source.url}\n         "${source.quote}"`);
  }
}
