/* GOO-688: the real GPT harness through OpenRouter, on a small made-up post
 * with one wrong claim, at low effort on the standard tier. Prints every
 * request's cache counters and cost, and writes the run to out/e2e.json.
 *
 * Usage: bun run src/scripts_jim/2026_11_02_openrouter_gpt_caching/e2e.ts [effort] [tier] */

import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { runJob, type ReasoningEffort } from "../../gpt-notes/harness";
import type { ServiceTier } from "../../gpt-notes/pricing";

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
process.env.OPENAI_AGENTS_DISABLE_TRACING = "1";

const POST = `Paris notes from a short trip.

The Eiffel Tower was finished in 1899 for the World's Fair, which is why it turned 125 in 2024.

The Louvre is the most visited art museum in the world, with almost nine million visitors in 2023.

We ate at a small bistro near the Seine and the onion soup was the best we ever had.`;

const [effort = "low", tier = "default"] = process.argv.slice(2);
const item = { id: "probe-item", url: "https://example.com/paris-notes", title: "Paris notes", full_text: POST, published_at: "2026-11-01", project: { name: "Probe", slug: "probe" }, checked_scope: null, first_checked_at: null, priority: 0, status: "queued", created_at: "2026-11-01" };
const started = Date.now();
const record = await runJob({ kind: "post", item: item as never, asked: { requests: [], onlyThese: false }, picks: {} }, { effort: effort as ReasoningEffort, tier: tier as ServiceTier, provider: "openrouter" });
for (const r of record.requests) console.log(`${r.agent} turn ${r.turn}: ${Math.round(r.durationMs / 1000)}s tier=${r.tier} in=${r.inputTokens} cached=${r.cachedTokens} write=${r.cacheWriteTokens} out=${r.outputTokens} searches=${r.webSearches} cost=$${r.costUsd.toFixed(4)}`);
const total = record.requests.reduce((sum, r) => sum + r.costUsd, 0);
console.log(`Total $${total.toFixed(3)} in ${Math.round((Date.now() - started) / 1000)}s, failed requests: ${JSON.stringify(record.failedRequests)}, skip: ${record.skipReason}`);
for (const d of record.drafts) console.log(`- ${d.outcome}: "${d.passage}" -> ${d.note} | sources: ${d.sources.map((s) => s.url).join(" ")}`);
mkdirSync(path.join(import.meta.dir, "out"), { recursive: true });
writeFileSync(path.join(import.meta.dir, "out/e2e.json"), JSON.stringify(record, null, 2));
