/**
 * Turns the raw extracts from extract.ts into prod_stats.md plus the smaller
 * JSON summaries (failing hosts, query sample, tag breakdown). Runs offline;
 * it never touches the database.
 *
 * Run from the repo root: bun run src/scripts_jim/2026_09_16_search_harness_research/analyze.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = import.meta.dir;
const TOP_HOSTS = 25;
const QUERY_SAMPLE_SIZE = 40;
/** Fixed seed so the query sample is the same on every run. */
const SAMPLE_SEED = 20260916;

const window = JSON.parse(readFileSync(join(DIR, "window.json"), "utf8"));
const runs: any[] = JSON.parse(readFileSync(join(DIR, "raw_runs.json"), "utf8"));
const searchCalls: any[] = JSON.parse(readFileSync(join(DIR, "raw_search_calls.json"), "utf8"));
const allFetchCalls: any[] = JSON.parse(readFileSync(join(DIR, "raw_fetch_calls.json"), "utf8"));

// One GLM 5.2 run on 2026-09-03 (13e2aa42) made 2,605 web_fetch calls in one
// turn, almost all of the same URL. Left in, it is three quarters of every X
// search-loop fetch and hides the real numbers, so runs above this cap are
// excluded here and listed at the top of the report.
const RUNAWAY_FETCHES_PER_RUN = 50;
const fetchesPerRun = new Map<string, number>();
for (const f of allFetchCalls) if (f.source.endsWith("_search")) fetchesPerRun.set(f.runId, (fetchesPerRun.get(f.runId) ?? 0) + 1);
const runawayRuns = [...fetchesPerRun].filter(([, n]) => n > RUNAWAY_FETCHES_PER_RUN);
const runawayIds = new Set(runawayRuns.map(([id]) => id));
const fetchCalls = allFetchCalls.filter((f) => !runawayIds.has(f.runId));

const WINDOW_LABEL = `${window.since.slice(0, 16)}Z to ${window.until.slice(0, 16)}Z (${window.days} days)`;

const SOURCE_LABEL: Record<string, string> = {
  x_search: "X pipeline, search loop",
  x_verifier: "X pipeline, source verifier",
  everything_check_search: "Common Notes claim check, search loop",
  everything_check_verifier: "Common Notes claim check, source verifier",
};
const SOURCES = Object.keys(SOURCE_LABEL);

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}
function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}
function fmtMs(v: number | null): string {
  return v === null ? "n/a" : `${(v / 1000).toFixed(1)} s`;
}
function countBy<T>(arr: T[], key: (x: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const x of arr) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function table(header: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function sample<T>(arr: T[], n: number, rand: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}

// ---------------------------------------------------------------------------
// 1. web_fetch
// ---------------------------------------------------------------------------

/** The verifier also reads X posts and media through other paths. Only the
 *  sections that went through fetchWebPage count as web fetches. */
const WEB_FETCH_KINDS = new Set(["ok", "ok_wayback", "ok_archiveph", "ok_browser", "failed"]);
const webFetches = fetchCalls.filter((f) => WEB_FETCH_KINDS.has(f.kind));

const fetchSummaryRows: (string | number)[][] = [];
const fetchTagRows: (string | number)[][] = [];
const hostSections: string[] = [];
const failingHostsOut: Record<string, [string, number][]> = {};
const tagsOut: Record<string, Record<string, number>> = {};

for (const source of SOURCES) {
  const calls = webFetches.filter((f) => f.source === source);
  const failed = calls.filter((f) => f.kind === "failed");
  const durations = calls.map((f) => f.durationMs).filter((d): d is number => typeof d === "number");
  const via = (kind: string) => calls.filter((f) => f.kind === kind).length;
  fetchSummaryRows.push([
    SOURCE_LABEL[source]!,
    calls.length,
    `${failed.length} (${pct(failed.length, calls.length)})`,
    `${via("ok_wayback")} (${pct(via("ok_wayback"), calls.length)})`,
    `${via("ok_archiveph")} (${pct(via("ok_archiveph"), calls.length)})`,
    `${via("ok_browser")} (${pct(via("ok_browser"), calls.length)})`,
    durations.length ? fmtMs(quantile(durations, 0.5)) : "not logged",
    durations.length ? fmtMs(quantile(durations, 0.9)) : "not logged",
  ]);

  const tags = countBy(failed, (f) => f.tag);
  tagsOut[source] = Object.fromEntries(tags);
  for (const [tag, n] of tags) fetchTagRows.push([SOURCE_LABEL[source]!, tag, n, pct(n, failed.length), pct(n, calls.length)]);

  const hosts = countBy(failed.filter((f) => f.host), (f) => f.host).slice(0, TOP_HOSTS);
  failingHostsOut[source] = hosts;
  const hostFailShare = (host: string) => {
    const all = calls.filter((f) => f.host === host).length;
    return `${all} attempts, ${pct(hosts.find(([h]) => h === host)![1], all)} failed`;
  };
  const tagOfHost = (host: string) => countBy(failed.filter((f) => f.host === host), (f) => f.tag).map(([t, n]) => `${t} ×${n}`).join(", ");
  hostSections.push(`### ${SOURCE_LABEL[source]}\n\n${table(["Host", "Failed fetches", "All fetches of this host", "Failure tags"], hosts.map(([h, n]) => [h, n, hostFailShare(h), tagOfHost(h)]))}`);
}

// Ladder rung that produced the final diagnostic. This says at which point the
// ladder gave up, which is useful for judging whether the archive and browser
// rungs are worth their time.
const rungRows = countBy(webFetches.filter((f) => f.kind === "failed" && f.lastAttempt), (f) => `${f.source}|${f.lastAttempt}`)
  .map(([k, n]) => { const [s, rung] = k.split("|"); return [SOURCE_LABEL[s!]!, rung!, n]; });

// Verifier-only: what the verifier read that was not a web fetch.
const verifierOtherRows = countBy(fetchCalls.filter((f) => f.source.endsWith("verifier") && !WEB_FETCH_KINDS.has(f.kind)), (f) => `${f.source}|${f.kind}`)
  .map(([k, n]) => { const [s, kind] = k.split("|"); return [SOURCE_LABEL[s!]!, kind!, n]; });

// ---------------------------------------------------------------------------
// 2. google_search
// ---------------------------------------------------------------------------

const backendOf = (run: any) => (run.searchArm?.endsWith("-searxng") ? "searxng (historical arm, removed)" : "serper");
const runById = new Map(runs.map((r) => [r.runId, r]));
const loopRuns = runs.filter((r) => r.hasLoop);

const searchRows: (string | number)[][] = [];
for (const source of ["x_search", "everything_check_search"]) {
  const calls = searchCalls.filter((c) => c.source === source);
  const durations = calls.map((c) => c.durationMs).filter((d): d is number => typeof d === "number");
  const noResults = calls.filter((c) => c.kind === "no_results").length;
  const errors = calls.filter((c) => c.kind === "error").length;
  const table_ = source === "x_search" ? "pipeline_runs" : "everything_pipeline_runs";
  const sourceRuns = loopRuns.filter((r) => r.table === table_);
  const perRun = sourceRuns.map((r) => r.googleSearches);
  searchRows.push([
    SOURCE_LABEL[source]!,
    calls.length,
    sourceRuns.length,
    (calls.length / Math.max(1, sourceRuns.length)).toFixed(2),
    quantile(perRun, 0.5) ?? "n/a",
    fmtMs(quantile(durations, 0.5)),
    fmtMs(quantile(durations, 0.9)),
    `${noResults} (${pct(noResults, calls.length)})`,
    `${errors} (${pct(errors, calls.length)})`,
  ]);
}

const perRunHistogram = (table_: string) => {
  const perRun = loopRuns.filter((r) => r.table === table_).map((r) => r.googleSearches);
  const buckets = ["0", "1", "2", "3", "4", "5", "6-8", "9-12", "13+"];
  const bucketOf = (n: number) => (n <= 5 ? String(n) : n <= 8 ? "6-8" : n <= 12 ? "9-12" : "13+");
  const counts = countBy(perRun, (n) => bucketOf(n));
  return buckets.map((b) => [b, counts.find(([k]) => k === b)?.[1] ?? 0, pct(counts.find(([k]) => k === b)?.[1] ?? 0, perRun.length)]);
};

const hasQuote = (q: string) => /["“”]/.test(q);
const hasSite = (q: string) => /\bsite:/i.test(q);
const hasYear = (q: string) => /\b(19|20)\d{2}\b/.test(q);
const hasMinus = (q: string) => /(^|\s)-\w/.test(q);
const queryFeatureRows: (string | number)[][] = [];
for (const source of ["x_search", "everything_check_search"]) {
  const qs = searchCalls.filter((c) => c.source === source).map((c) => c.query);
  const n = qs.length;
  const words = qs.map((q) => q.trim().split(/\s+/).length);
  queryFeatureRows.push([
    SOURCE_LABEL[source]!,
    n,
    `${qs.filter(hasQuote).length} (${pct(qs.filter(hasQuote).length, n)})`,
    `${qs.filter(hasSite).length} (${pct(qs.filter(hasSite).length, n)})`,
    `${qs.filter(hasYear).length} (${pct(qs.filter(hasYear).length, n)})`,
    `${qs.filter(hasMinus).length} (${pct(qs.filter(hasMinus).length, n)})`,
    quantile(words, 0.5) ?? "n/a",
    quantile(words, 0.9) ?? "n/a",
  ]);
}

const rand = seededRandom(SAMPLE_SEED);
const querySample = sample(searchCalls, QUERY_SAMPLE_SIZE, rand).map((c) => ({
  source: c.source,
  model: runById.get(c.runId)?.searchModel ?? runById.get(c.runId)?.searchArm ?? null,
  query: c.query,
  outcome: c.kind,
  durationMs: c.durationMs,
}));

// ---------------------------------------------------------------------------
// 3. search backend errors
// ---------------------------------------------------------------------------

const searchErrors = searchCalls.filter((c) => c.kind === "error");
const serperUnavailableInTools = searchErrors.filter((c) => c.error?.includes("serper_unavailable")).length;
const googleSearchFailedInTools = searchErrors.length;
const serperUnavailableInErrorMessages = (window.serperErrorMessages as any[]).filter((r) => r.error_message?.includes("serper_unavailable")).length;

// ---------------------------------------------------------------------------
// 4. turns and forced synthesis
// ---------------------------------------------------------------------------

const turnRows: (string | number)[][] = [];
for (const [label, table_, maxTurns] of [["X pipeline, search loop", "pipeline_runs", 6], ["Common Notes claim check, search loop", "everything_pipeline_runs", 6]] as const) {
  const rs = loopRuns.filter((r) => r.table === table_);
  const turns = rs.map((r) => r.turns);
  const forced = rs.filter((r) => r.forcedSynthesis).length;
  const atCap = rs.filter((r) => r.turns >= maxTurns).length;
  const unsupported = rs.filter((r) => r.forcedToolCallUnsupported).length;
  turnRows.push([
    label,
    rs.length,
    quantile(turns, 0.5) ?? "n/a",
    (turns.reduce((a, b) => a + b, 0) / Math.max(1, rs.length)).toFixed(2),
    `${atCap} (${pct(atCap, rs.length)})`,
    `${forced} (${pct(forced, rs.length)})`,
    unsupported,
  ]);
}
const turnHistogram = (table_: string) => {
  const turns = loopRuns.filter((r) => r.table === table_).map((r) => r.turns);
  const counts = countBy(turns, (t) => String(t));
  return [1, 2, 3, 4, 5, 6].map((t) => [t, counts.find(([k]) => k === String(t))?.[1] ?? 0, pct(counts.find(([k]) => k === String(t))?.[1] ?? 0, turns.length)]);
};
const forcedByArm = countBy(loopRuns.filter((r) => r.forcedSynthesis), (r) => `${r.table}|${r.searchArm}`).map(([k, n]) => {
  const [t, arm] = k.split("|");
  const all = loopRuns.filter((r) => r.table === t && r.searchArm === arm).length;
  return [t === "pipeline_runs" ? "X" : "Common Notes", arm!, n, all, pct(n, all)];
});

// Runs that reached the verifier but never logged a loop turn searched through
// a provider's built-in web search (an OpenRouter native arm), which leaves no
// per-call record. This shows how much of the traffic the loop numbers cover.
const nonLoopSearchArmRows = countBy(runs.filter((r) => r.verifierTurns > 0 && !r.hasLoop), (r) => `${r.table}|${r.searchArm}`).map(([k, n]) => {
  const [t, arm] = k.split("|");
  return [t === "pipeline_runs" ? "X" : "Common Notes", arm!, n];
});

const loopArmRows = countBy(loopRuns, (r) => `${r.table}|${r.searchArm}`).map(([k, n]) => {
  const [t, arm] = k.split("|");
  return [t === "pipeline_runs" ? "X" : "Common Notes", arm!, n, backendOf({ searchArm: arm })];
});
const verifierArmRows = countBy(runs.filter((r) => r.verifierTurns > 0), (r) => `${r.table}|${r.verifierArm}`).map(([k, n]) => {
  const [t, arm] = k.split("|");
  return [t === "pipeline_runs" ? "X" : "Common Notes", arm!, n];
});

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

const md = `# Web fetch and web search in production, last 14 days

**Window: ${WINDOW_LABEL}.** Every number below covers exactly this window unless a row says otherwise. Generated by \`extract.ts\` (prod read) and \`analyze.ts\` (offline) in this folder on ${new Date().toISOString().slice(0, 10)}.

**Runaway runs left out of the fetch numbers.** A run with more than ${RUNAWAY_FETCHES_PER_RUN} web fetches is excluded from every fetch table below, because it would hide the real numbers. In this window that is ${runawayRuns.length === 0 ? "no run" : runawayRuns.map(([id, n]) => `run \`${id}\` (${n} web fetches)`).join(", ")}. That run (X pipeline, search arm glm52-serper, 2026-09-03) asked for 2,621 tool calls in a single turn, 2,605 of them web fetches of only 16 distinct URLs. The loop executed all of them one after the other, and the next model call then failed because the tool results added up to 3.3 million tokens. It is counted in the search-call and turn tables, where it is one run.

## What was read and what could not be measured

| Source | Table | Rows in window | Where the tool calls live in the row |
| --- | --- | --- | --- |
| X pipeline | \`pipeline_runs\` | ${window.xRuns} runs (${loopRuns.filter((r) => r.table === "pipeline_runs").length} reached the search loop, ${runs.filter((r) => r.table === "pipeline_runs" && r.verifierTurns > 0).length} reached the verifier) | \`logs.note_writer_steps.search.turn.<n>.<google_search\\|web_fetch>[_k]\`, \`logs.note_writer_steps.search.forced_synthesis\`, verifier fetches inside \`logs.note_writer_steps.source_verifier.turn.<n>.messages.0.userMessage\` |
| Common Notes claim checks | \`everything_pipeline_runs\` with \`kind = 'check'\` | ${window.everythingCheckRuns} runs (${loopRuns.filter((r) => r.table === "everything_pipeline_runs").length} reached the search loop, ${runs.filter((r) => r.table === "everything_pipeline_runs" && r.verifierTurns > 0).length} reached the verifier) | same keys, because a claim check is a full simple-bot run |
| Common Notes claim rater | \`everything_pipeline_runs\` with \`kind = 'rating'\` | ${window.ratingRows} rows, ${window.ratingRowsWithLogs} of them with a log | **Not measurable.** \`rateClaims.ts\` calls \`runToolLoop\` without a \`log\` callback and \`insertItemRun\` stores only the cost, so the rater's searches and fetches are never written down. Only its total search and fetch counts exist in the CI run output. |

Differences from the description I was given, found by reading the code:

- The tweet log is stored **nested**, not flat: \`logs.note_writer_steps.search.turn["2"].google_search\`. \`nestDotKeys\` in \`src/pipeline/utils/tweetLog.ts\` converts the dotted keys before the row is written. Several tool calls in one turn get suffixes \`google_search_1\`, \`google_search_2\`, and so on.
- The search loop's prefix is \`note_writer_steps.search\`, not \`search\`. The step names come from \`STEP\` in \`src/pipeline/utils/noteWriterSteps.ts\`.
- The source verifier logs **no fetch result and no duration**. \`fetchAsWebPage\` in \`src/pipeline/verify/sourceVerifier.ts\` returns the content straight into the prompt; the only verifier log keys are \`source.<i>.media_error\`, \`snapshot_urls\`, \`claims\` and \`messages\`. I therefore recovered the verifier's fetches by parsing the \`### <url>\` sections under "## Note's cited sources (verify these)" in \`messages.0.userMessage\`. Failures are recognisable there because the section body starts with \`Fetch failed:\` / \`Fetch error:\`, and archive fallbacks with \`[fetched via ...]\`. Durations are not available for the verifier.
- \`everything_pipeline_runs\` has no \`error_message\` column (migration 068), so "Google search failed" could only be counted inside tool results for that table.
- The \`*-searxng\` search arms in the window are historical: the SearXNG backend was removed and those arm names replay against Serper now (\`abTestsData.ts\`). Their runs in this window predate the removal and carry the two "SearXNG exhausted" errors.

Hostnames are grouped with a leading \`www.\` stripped. A "web fetch" for the verifier means a cited URL that went through \`fetchWebPage\`; X posts (syndication), media sources (yt-dlp + Gemini) and the search-snippet fallback are listed separately.

## 1. web_fetch

### Totals per caller

| Caller | Web fetches | Failed | Succeeded only via Wayback | Succeeded only via archive.ph | Succeeded only via headless browser | Median duration | p90 duration |
| --- | --- | --- | --- | --- | --- | --- | --- |
${fetchSummaryRows.map((r) => `| ${r.join(" | ")} |`).join("\n")}

Durations cover the whole ladder for one call (HTTP user agents, then archives, then browser). The verifier has no duration because it does not log its fetches.

### Failure tags

"Share of failures" is within the caller's failed fetches; "share of all fetches" is within all of that caller's web fetches.

${table(["Caller", "Tag", "Count", "Share of failures", "Share of all fetches"], fetchTagRows)}

The tag is the diagnostic \`fetchWebPage\` chose. It prefers a login-wall or thin-content reading over a plain HTTP failure when any rung produced one, so an \`HTTP 403\` here means no rung ever got a page body at all, not even the archives or the browser.

### Which rung produced the failure diagnostic

For the wall and thin tags this is the rung whose body was inspected; for HTTP tags it is the last rung tried (normally \`browser\`, since the browser is the final rung).

${table(["Caller", "Rung", "Failed fetches"], rungRows)}

### Top ${TOP_HOSTS} failing hostnames per caller

${hostSections.join("\n\n")}

### What else the verifier read (not web fetches)

${table(["Caller", "Kind", "Count"], verifierOtherRows)}

\`twitter\` = an X post read through the syndication endpoint; \`twitter_unfetched\` = an X post that could not be read and was accepted without content; \`media\` = a video or image source described by yt-dlp + Gemini; \`snippet_fallback\` = the page failed but a search snippet stood in for it.

## 2. google_search

### Totals per caller

"Runs" counts runs that reached the search loop at all. Errors are the \`Google search failed:\` results, see section 3.

${table(["Caller", "Searches", "Runs with a loop", "Searches per run (mean)", "Searches per run (median)", "Median duration", "p90 duration", "Returned \"No results.\"", "Errors"], searchRows)}

### Searches per run

X pipeline, search loop:

${table(["Searches in the run", "Runs", "Share"], perRunHistogram("pipeline_runs"))}

Common Notes claim check, search loop:

${table(["Searches in the run", "Runs", "Share"], perRunHistogram("everything_pipeline_runs"))}

### Query features

A "quote" is any of \`"\`, \`“\`, \`”\`. A "year" is a four-digit 19xx or 20xx token. "Minus" is a leading \`-word\` exclusion operator.

${table(["Caller", "Queries", "Contain a quote", "Contain site:", "Contain a year", "Contain a minus operator", "Words (median)", "Words (p90)"], queryFeatureRows)}

### Random sample of ${QUERY_SAMPLE_SIZE} queries

Drawn with a fixed seed from all ${searchCalls.length} queries in the window across both callers. The full list with run ids is in \`query_sample.json\`.

${table(["#", "Caller", "Search model", "Query", "Outcome"], querySample.map((q, i) => [i + 1, q.source, q.model ?? "", q.query.replace(/\|/g, "\\|"), q.outcome]))}

## 3. Search backend errors

| Where | Count in window |
| --- | --- |
| \`serper_unavailable\` inside a \`google_search\` tool result | ${serperUnavailableInTools} |
| \`Google search failed:\` inside a \`google_search\` tool result (any cause) | ${googleSearchFailedInTools} |
| \`serper_unavailable\` in \`pipeline_runs.error_message\` | ${serperUnavailableInErrorMessages} |
| \`pipeline_runs.error_message\` containing "serper" at all | ${(window.serperErrorMessages as any[]).length} |

${googleSearchFailedInTools ? `The tool-result errors:\n\n${table(["Caller", "Error"], searchErrors.map((e) => [e.source, String(e.error).slice(0, 160).replace(/\|/g, "\\|")]))}` : "No tool-result errors."}

${(window.serperErrorMessages as any[]).length ? `The \`error_message\` rows that mention "serper" are all the search loop's own JSON parsing failures ("serper loop final: model output was not valid JSON"), not Serper outages:\n\n${table(["Run", "Created", "Error message (head)"], (window.serperErrorMessages as any[]).map((r) => [r.id, r.created_at.slice(0, 19), String(r.error_message).slice(0, 110).replace(/\n/g, " ").replace(/\|/g, "\\|")]))}` : ""}

Serper's client (\`src/pipeline/tool-calling/serper.ts\`) retries four times with backoff before it throws \`serper_unavailable\`, so a transient failure that recovered within the retries leaves no trace in the logs.

## 4. Tool-loop turns and forced synthesis

The search loop is capped at \`SEARCH_LOOP_MAX_TURNS = 6\` (\`searchDispatch.ts\`). "Turns" is the number of the last turn that made a tool call; a run that answered on turn 1 without tools has 0 turns and does not appear here (it never logged a turn). \`forced_synthesis\` fires when the model was still calling tools after the last turn and one extra call without tools produced the answer. "Forced tool call unsupported" counts runs where the provider rejected \`tool_choice: required\` on turn 1 (Meta for Muse).

${table(["Caller", "Runs with a loop", "Turns (median)", "Turns (mean)", "Runs that hit the 6-turn cap", "forced_synthesis fired", "Forced tool call unsupported"], turnRows)}

A run that made a tool call on turn 6 always ends in forced synthesis, because the loop has no turn 7 for the model to answer in, so the cap and forced_synthesis columns are the same runs.

Turn distribution, X pipeline:

${table(["Turns", "Runs", "Share"], turnHistogram("pipeline_runs"))}

Turn distribution, Common Notes claim checks:

${table(["Turns", "Runs", "Share"], turnHistogram("everything_pipeline_runs"))}

forced_synthesis by search arm:

${table(["Pipeline", "Search arm", "Forced synthesis", "Runs with a loop on this arm", "Share"], forcedByArm)}

The rater's loop (\`RATING_MAX_TURNS = 8\`, 12 searches and 6 fetches per part) is not in the database, see the first table.

## Appendix: which arms produced the data

Search-loop runs by arm:

${table(["Pipeline", "Search arm", "Runs with a loop", "Backend"], loopArmRows)}

Runs that reached the verifier without a logged loop turn, by search arm. These searched through a provider's built-in web search, which logs no per-call records, so nothing above covers them:

${table(["Pipeline", "Search arm", "Runs"], nonLoopSearchArmRows)}

Verifier runs by arm:

${table(["Pipeline", "Verifier arm", "Runs with a verifier turn"], verifierArmRows)}

## Files in this folder

- \`extract.ts\`: reads prod and writes the raw extracts.
- \`analyze.ts\`: writes this file and the summaries below from the raw extracts.
- \`window.json\`: the exact window, row counts, and the three "serper" error_message rows.
- \`raw_runs.json\`: one record per run (arms, turns, forced_synthesis, tool-call counts).
- \`raw_search_calls.json\`: one record per google_search call (query, outcome, duration).
- \`raw_fetch_calls.json\`: one record per web_fetch call and per verifier source section (url, host, kind, tag, rung, duration).
- \`failing_hosts.json\`: the top ${TOP_HOSTS} failing hosts per caller.
- \`fetch_tags.json\`: failure tag counts per caller.
- \`query_sample.json\`: the ${QUERY_SAMPLE_SIZE} sampled queries.
`;

writeFileSync(join(DIR, "prod_stats.md"), md);
writeFileSync(join(DIR, "failing_hosts.json"), JSON.stringify(failingHostsOut, null, 2));
writeFileSync(join(DIR, "fetch_tags.json"), JSON.stringify(tagsOut, null, 2));
writeFileSync(join(DIR, "query_sample.json"), JSON.stringify(querySample, null, 2));
console.log("wrote prod_stats.md");
