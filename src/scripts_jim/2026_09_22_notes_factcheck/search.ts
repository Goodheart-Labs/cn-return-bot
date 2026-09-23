// Command-line Google search through the pipeline's Serper client, for reviewer
// subagents once the session's built-in web search budget is used up.
// Usage: bun run src/scripts_jim/2026_09_22_notes_factcheck/search.ts "<query>"
import "dotenv/config";
import { fetchSearchResults } from "../../pipeline/tool-calling/serper";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error("usage: search.ts <query>");
  process.exit(1);
}
const results = await fetchSearchResults(query);
for (const r of results) {
  console.log(`- ${r.title}\n  ${r.url}${r.publishedDate ? `  (${r.publishedDate})` : ""}\n  ${r.content}`);
}
