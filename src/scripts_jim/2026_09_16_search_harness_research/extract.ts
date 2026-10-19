/**
 * Pulls every X pipeline run and every Common Notes claim-check run from the
 * last 14 days and extracts one record per web_fetch call, per google_search
 * call and per source the verifier fetched. Read-only against prod. The raw
 * extracts land as JSON next to this script and analyze.ts turns them into
 * prod_stats.md.
 *
 * Run from the repo root: bun run src/scripts_jim/2026_09_16_search_harness_research/extract.ts
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(import.meta.dir);
const WINDOW_DAYS = 14;
const PAGE_SIZE = 100;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

type Source = "x_search" | "x_verifier" | "everything_check_search" | "everything_check_verifier";

interface RunRecord {
  table: string;
  runId: string;
  createdAt: string;
  outcome: string | null;
  searchArm: string | null;
  verifierArm: string | null;
  searchModel: string | null;
  hasLoop: boolean;
  turns: number;
  forcedSynthesis: boolean;
  forcedToolCallUnsupported: boolean;
  googleSearches: number;
  webFetches: number;
  verifierTurns: number;
}

interface SearchCall {
  source: Source;
  runId: string;
  turn: number;
  query: string;
  kind: "results" | "no_results" | "error";
  error: string | null;
  durationMs: number | null;
}

interface FetchCall {
  source: Source;
  runId: string;
  turn: number;
  url: string;
  host: string | null;
  /** ok = direct fetch. The archive kinds are successes via a fallback. */
  kind: "ok" | "ok_wayback" | "ok_archiveph" | "ok_browser" | "failed" | "twitter" | "twitter_unfetched" | "media" | "snippet_fallback" | "unknown";
  /** Failure tag such as "login wall / anti-bot block", "thin content", "HTTP 403", "all attempts failed". */
  tag: string | null;
  /** Which rung of the ladder produced the failure diagnostic, e.g. "desktop", "browser". */
  lastAttempt: string | null;
  durationMs: number | null;
  resultChars: number;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Classifies the string fetchWebPage returns. */
function classifyFetchResult(result: string): Pick<FetchCall, "kind" | "tag" | "lastAttempt"> {
  if (result.startsWith("[fetched via wayback snapshot]")) return { kind: "ok_wayback", tag: null, lastAttempt: "wayback" };
  if (result.startsWith("[fetched via archive.ph snapshot]")) return { kind: "ok_archiveph", tag: null, lastAttempt: "archive.ph" };
  if (result.startsWith("[fetched via headless browser]")) return { kind: "ok_browser", tag: null, lastAttempt: "browser" };
  const wall = result.match(/^Fetch failed: (login wall \/ anti-bot block|thin content) \((\w[\w.]*), (\d+) chars\)/);
  if (wall) return { kind: "failed", tag: wall[1]!, lastAttempt: wall[2]! };
  const http = result.match(/^Fetch failed: HTTP (\d+) \(last attempt: ([\w.]+)\)/);
  if (http) return { kind: "failed", tag: `HTTP ${http[1]}`, lastAttempt: http[2]! };
  if (result.startsWith("Fetch error: all")) return { kind: "failed", tag: "all attempts failed", lastAttempt: null };
  if (result.startsWith("Fetch failed:") || result.startsWith("Fetch error:")) return { kind: "failed", tag: result.slice(0, 80), lastAttempt: null };
  return { kind: "ok", tag: null, lastAttempt: "http" };
}

/** Classifies one `### <url>\n<content>` section of the verifier's user message. */
function classifyVerifierSection(content: string): Pick<FetchCall, "kind" | "tag" | "lastAttempt"> {
  if (content.startsWith("Twitter/X link — tweet could not be fetched")) return { kind: "twitter_unfetched", tag: null, lastAttempt: null };
  if (content.startsWith("Twitter/X post by")) return { kind: "twitter", tag: null, lastAttempt: null };
  if (content.startsWith("Automated video analysis") || content.startsWith("Automated image analysis")) return { kind: "media", tag: null, lastAttempt: null };
  if (content.startsWith("[from search snippet")) return { kind: "snippet_fallback", tag: null, lastAttempt: null };
  return classifyFetchResult(content);
}

const SOURCES_HEADER = "## Note's cited sources (verify these)\n";
const SOURCES_END = "\n## Original post";

function parseVerifierSections(userMessage: string): { url: string; content: string }[] {
  const start = userMessage.indexOf(SOURCES_HEADER);
  if (start < 0) return [];
  const afterHeader = start + SOURCES_HEADER.length;
  const end = userMessage.indexOf(SOURCES_END, afterHeader);
  const block = userMessage.slice(afterHeader, end < 0 ? undefined : end);
  // A fetched page can itself contain markdown h3 headings, so only a heading
  // that is a URL starts a new source. Any other heading belongs to the
  // content of the source before it.
  const sections: { url: string; content: string }[] = [];
  for (const piece of block.split(/\n(?=### )/)) {
    const nl = piece.indexOf("\n");
    const heading = (nl < 0 ? piece : piece.slice(0, nl)).replace(/^### /, "").trim();
    const body = nl < 0 ? "" : piece.slice(nl + 1);
    if (/^https?:\/\//.test(heading)) sections.push({ url: heading, content: body });
    else if (sections.length > 0) sections[sections.length - 1]!.content += `\n${piece}`;
  }
  return sections;
}

function extractRun(table: string, row: any, searchSource: Source, verifierSource: Source, searchCalls: SearchCall[], fetchCalls: FetchCall[]): RunRecord {
  const steps = row.steps ?? {};
  const picks = row.ab_test_picks ?? steps?.bot?.picks ?? {};
  const search = steps.search ?? {};
  const turns = search.turn ?? {};
  const turnNumbers = Object.keys(turns).map(Number).filter((n) => !Number.isNaN(n));
  let googleSearches = 0;
  let webFetches = 0;
  for (const turn of turnNumbers) {
    for (const [key, call] of Object.entries<any>(turns[turn] ?? {})) {
      if (key.startsWith("google_search")) {
        googleSearches++;
        const result = call?.result;
        const error = typeof result === "object" && result?.error ? String(result.error) : null;
        const text = typeof result === "object" ? result?.results : result;
        searchCalls.push({
          source: searchSource,
          runId: row.id,
          turn,
          query: String(call?.args?.query ?? ""),
          kind: error ? "error" : text === "No results." ? "no_results" : "results",
          error,
          durationMs: typeof call?.durationMs === "number" ? call.durationMs : null,
        });
      } else if (key.startsWith("web_fetch")) {
        webFetches++;
        const result = typeof call?.result === "string" ? call.result : JSON.stringify(call?.result ?? "");
        const url = String(call?.args?.url ?? "");
        fetchCalls.push({
          source: searchSource,
          runId: row.id,
          turn,
          url,
          host: hostOf(url),
          ...classifyFetchResult(result),
          durationMs: typeof call?.durationMs === "number" ? call.durationMs : null,
          resultChars: result.length,
        });
      }
    }
  }
  const verifierTurns = steps.source_verifier?.turn ?? {};
  for (const [turnKey, vt] of Object.entries<any>(verifierTurns)) {
    const userMessage = vt?.messages?.["0"]?.userMessage;
    if (typeof userMessage !== "string") continue;
    for (const section of parseVerifierSections(userMessage)) {
      fetchCalls.push({
        source: verifierSource,
        runId: row.id,
        turn: Number(turnKey),
        url: section.url,
        host: hostOf(section.url),
        ...classifyVerifierSection(section.content),
        durationMs: null,
        resultChars: section.content.length,
      });
    }
  }
  return {
    table,
    runId: row.id,
    createdAt: row.created_at,
    outcome: row.outcome ?? null,
    searchArm: picks.simple_bot_search ?? null,
    verifierArm: picks.simple_bot_verifier ?? null,
    searchModel: search.messages?.["0"]?.model ?? null,
    hasLoop: turnNumbers.length > 0,
    turns: turnNumbers.length ? Math.max(...turnNumbers) : 0,
    forcedSynthesis: search.forced_synthesis === true,
    forcedToolCallUnsupported: search.forcedToolCallUnsupported !== undefined,
    googleSearches,
    webFetches,
    verifierTurns: Object.keys(verifierTurns).length,
  };
}

/** Keyset pagination on created_at. Offset pagination over the jsonb column
 *  hits the statement timeout once the offset grows past a few thousand rows.
 *  Rows sharing the exact same created_at as a page boundary would be skipped;
 *  timestamps carry microseconds, so that loss is negligible for this report. */
async function fetchAll(table: string, select: string, since: string, until: string, extraFilter?: (q: any) => any): Promise<any[]> {
  const rows: any[] = [];
  let cursor = since;
  let pageSize = PAGE_SIZE;
  for (;;) {
    let q = db.from(table).select(select).gt("created_at", cursor).lt("created_at", until).order("created_at", { ascending: true }).limit(pageSize);
    if (extraFilter) q = extraFilter(q);
    const { data, error } = await q;
    if (error) {
      if (error.message.includes("timeout") && pageSize > 25) {
        pageSize = Math.floor(pageSize / 2);
        process.stderr.write(`\n${table}: timeout, retrying with page size ${pageSize}\n`);
        continue;
      }
      throw new Error(`${table} after ${cursor}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    cursor = data[data.length - 1].created_at;
    process.stderr.write(`${table}: ${rows.length} rows\r`);
    if (data.length < pageSize) break;
  }
  process.stderr.write("\n");
  return rows;
}

async function main() {
  const until = new Date();
  const since = new Date(until.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
  const window = { since: since.toISOString(), until: until.toISOString(), days: WINDOW_DAYS };
  console.log("window", window);

  const runs: RunRecord[] = [];
  const searchCalls: SearchCall[] = [];
  const fetchCalls: FetchCall[] = [];

  const xRows = await fetchAll("pipeline_runs", "id, created_at, outcome, ab_test_picks, steps:logs->note_writer_steps", window.since, window.until);
  for (const row of xRows) runs.push(extractRun("pipeline_runs", row, "x_search", "x_verifier", searchCalls, fetchCalls));

  const eRows = await fetchAll("everything_pipeline_runs", "id, created_at, kind, outcome, ab_test_picks, steps:logs->note_writer_steps", window.since, window.until, (q) => q.eq("kind", "check"));
  for (const row of eRows) runs.push(extractRun("everything_pipeline_runs", row, "everything_check_search", "everything_check_verifier", searchCalls, fetchCalls));

  const { count: ratingRows } = await db.from("everything_pipeline_runs").select("id", { count: "exact", head: true }).gte("created_at", window.since).lt("created_at", window.until).eq("kind", "rating");
  const { count: ratingRowsWithLogs } = await db.from("everything_pipeline_runs").select("id", { count: "exact", head: true }).gte("created_at", window.since).lt("created_at", window.until).eq("kind", "rating").not("logs", "is", null);
  const { data: serperErrors } = await db.from("pipeline_runs").select("id, created_at, final_stage, error_message").gte("created_at", window.since).lt("created_at", window.until).ilike("error_message", "%serper%");

  writeFileSync(join(OUT_DIR, "window.json"), JSON.stringify({ ...window, xRuns: xRows.length, everythingCheckRuns: eRows.length, ratingRows, ratingRowsWithLogs, serperErrorMessages: serperErrors ?? [] }, null, 2));
  writeFileSync(join(OUT_DIR, "raw_runs.json"), JSON.stringify(runs));
  writeFileSync(join(OUT_DIR, "raw_search_calls.json"), JSON.stringify(searchCalls));
  writeFileSync(join(OUT_DIR, "raw_fetch_calls.json"), JSON.stringify(fetchCalls));
  console.log({ runs: runs.length, searchCalls: searchCalls.length, fetchCalls: fetchCalls.length, ratingRows, ratingRowsWithLogs, serperErrorMessages: serperErrors?.length });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
