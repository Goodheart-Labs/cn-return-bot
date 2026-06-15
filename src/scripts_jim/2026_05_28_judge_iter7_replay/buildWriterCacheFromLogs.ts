/**
 * Build the cheap-bot writer cache from a prior full run's per-row logs, so a
 * judge/verifier-only replay needs zero stage-1-3 work (no SearXNG, no money).
 *
 * A populated run already logged everything stages 1-3 produce:
 *   - userMessage  ← cheapBot.queryWriter.messages.0.userMessage (full)
 *   - queries      ← cheapBot.queries
 *   - findings     ← cheapBot.analyzedFindings (analyzer on) | searchFindings
 *   - noteText/src ← simpleBot.writer.attempts.0.response
 *   - snippets     ← rebuilt from the search cache (keyed by the logged queries)
 *
 * The judge never receives findings and the verifier rebuilds snippets from the
 * search cache, so the reconstructed cache is faithful for an FP measurement.
 * (findings is logged truncated to 4000 chars; it only feeds the rare verifier-
 * revision prompt + the final searchResults log, not the judge.)
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_28_judge_iter7_replay/buildWriterCacheFromLogs.ts \
 *     dataset_runs/tryout-iter-06-cheap-bot-2026-05-28-1918 datasets/big_eval/_writer_cache
 */
import * as fs from "fs";
import * as path from "path";
import { readSearchCache } from "../../pipeline/cheap-bot/searchCache";
import { writeWriterCache, type Snippet, type WriterStageResult } from "../../pipeline/replay/writerCache";

const runDir = process.argv[2];
const writerCacheDir = process.argv[3] ?? "datasets/big_eval/_writer_cache";
if (!runDir) {
  console.error("usage: buildWriterCacheFromLogs.ts <run-folder> [writer-cache-dir]");
  process.exit(1);
}

// Cache modules read these env vars lazily (inside cacheDir(), at call time),
// so setting them here — before the loop calls read/write — is sufficient.
process.env.SEARCH_CACHE = process.env.SEARCH_CACHE ?? "datasets/big_eval/_search_cache";
process.env.WRITER_CACHE = writerCacheDir;

const MAX_RESULTS_PER_QUERY = 6; // mirror orchestrator.fetchAndFormatSearch

function rebuildSnippets(queries: string[]): [string, Snippet][] {
  const snippetsByUrl = new Map<string, Snippet>();
  for (const q of queries) {
    const results = readSearchCache(q);
    if (!results) continue; // query exhausted / not cached → contributed nothing live either
    for (const r of results.slice(0, MAX_RESULTS_PER_QUERY)) {
      if (!snippetsByUrl.has(r.url)) snippetsByUrl.set(r.url, { title: r.title, snippet: r.content });
    }
  }
  return [...snippetsByUrl.entries()];
}

function earlyExitReason(cb: any, noteText: string, queries: string[]): string {
  if (queries.length === 0) return "query writer returned no queries — post likely opinion or non-checkable";
  if ((cb?.searchResultCount ?? 0) === 0) {
    return (cb?.searchExhaustedCount ?? 0) === queries.length
      ? "searxng_all_providers_exhausted: every SearXNG provider failed for every query — infrastructure failure, not a pipeline decision"
      : "no_evidence_found: every search query returned zero results — refusing to write a note without evidence";
  }
  if (!noteText.trim()) return "writer_returned_empty: no dispute found in research findings";
  return "no_correction (reconstructed from logs)";
}

let writerDone = 0;
let earlyExit = 0;
let missingId = 0;

const files = fs.readdirSync(runDir).filter((f) => f.endsWith(".json"));
for (const file of files) {
  const rows = JSON.parse(fs.readFileSync(path.join(runDir, file), "utf8"));
  if (!Array.isArray(rows)) continue;
  for (const row of rows) {
    const logs = row.logs ?? {};
    const tweetId: string | undefined = logs?.tweet?.post?.id;
    if (!tweetId) { missingId++; continue; }

    const cb = logs.cheapBot ?? {};
    const queries: string[] = cb.queries ?? [];
    const userMessage: string = logs?.cheapBot?.queryWriter?.messages?.["0"]?.userMessage ?? "";
    const findings: string = cb.analyzedFindings ?? cb.searchFindings ?? "";
    const response = logs?.simpleBot?.writer?.attempts?.["0"]?.response ?? {};
    const noteText: string = response.note_text ?? "";
    const sources: string[] = response.sources ?? [];

    let stage: WriterStageResult;
    if (queries.length > 0 && noteText.trim()) {
      stage = {
        kind: "writer_done",
        userMessage,
        findings,
        queries,
        noteText,
        sources,
        snippets: rebuildSnippets(queries),
      };
      writerDone++;
    } else {
      stage = { kind: "early_exit", outcome: { type: "no_correction", reason: earlyExitReason(cb, noteText, queries) } };
      earlyExit++;
    }
    writeWriterCache(tweetId, stage);
  }
}

console.log(`writer cache built in ${writerCacheDir}`);
console.log(`  writer_done: ${writerDone} | early_exit: ${earlyExit} | rows missing tweetId: ${missingId}`);
