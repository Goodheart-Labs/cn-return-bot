/**
 * Query-writer evaluation harness.
 *
 * Loads a dataset split (val/test/few_shot_pool) + a system-prompt variant,
 * runs the DeepSeek query writer on each row, hits a multi-engine search
 * backend, and scores each row against the reference URLs / domains.
 *
 * Search-result cache lives in datasets/query_writer_eval/_search_cache/
 * keyed by (query, engines) so repeated eval runs with overlapping queries
 * cost nothing.
 *
 * The eval-time search backend is DELIBERATELY DIFFERENT from production:
 * production uses google-only (currently rate-limited); eval uses
 * google+bing+duckduckgo with language=en to be reliable across rerolls.
 * A good query should work on any reasonable engine — measuring with
 * multi-engine gives a denoised signal on query quality.
 */

import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
import PQueue from "p-queue";
import { buildUserMessage } from "../../pipeline/input/prompt";
import { llm } from "../../pipeline/llm/llm";
import { fetchSearxngResults as fetchSearxngProvider } from "../2026_05_27_searxng_speedup/proposed_searxng";
import Exa from "exa-js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../..");
const EVAL_ROOT = path.join(REPO_ROOT, "datasets", "query_writer_eval");
const CACHE_DIR = path.join(EVAL_ROOT, "_search_cache");
const INPUTS_DIR = path.join(REPO_ROOT, "datasets", "big_eval", "inputs");
const RUNS_DIR = path.join(EVAL_ROOT, "runs");
const TOP_K_PER_QUERY = 10;
const MAX_QUERIES = 5;
const MODEL = "deepseek/deepseek-v4-flash";

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(RUNS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Candidate {
  tweet_id: string;
  url: string;
  tweet_text: string;
  tweet_summary: string;
  categories: string[];
  primary_category: string;
  why_note_decision: string;
  reference_note: string;
  reference_urls: string[];
  reference_urls_non_social: string[];
  reference_domains: string[];
  reference_domains_all: string[];
  judge_guidance: string;
  original_note_text: string;
  difficulty: string;
  importance_prominence: string;
}

export interface SearxResult {
  title: string;
  url: string;
  content: string;
}

export interface QueryRunResult {
  query: string;
  results: SearxResult[];
  error?: string;
}

export interface RowResult {
  tweet_id: string;
  primary_category: string;
  reference_urls: string[];
  reference_domains: string[];
  user_message_chars: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  queries: string[];
  per_query: QueryRunResult[];
  all_result_urls: string[];
  all_result_domains: string[];
  // scoring
  hit_url: boolean;             // any exact URL match
  hit_domain: boolean;          // any reference domain appears in results
  matched_urls: string[];
  matched_domains: string[];
  // detailed
  errored: boolean;
  error_message?: string;
  llm_call_seconds?: number;
}

export interface RunSummary {
  variant: string;
  split: string;
  n: number;
  hit_url_pct: number;
  hit_domain_pct: number;
  judge_sufficient_pct?: number;
  errored: number;
  avg_queries: number;
  empty_query_rows: number;
  per_category: Record<string, { n: number; hit_domain_pct: number; hit_url_pct: number; judge_sufficient_pct?: number }>;
}

// ---------------------------------------------------------------------------
// Domain helpers (must match the Python ones in 01_build_dataset.py)
// ---------------------------------------------------------------------------

const SOCIAL_DOMAINS = new Set([
  "x.com", "twitter.com", "instagram.com", "facebook.com",
  "tiktok.com", "threads.net", "youtube.com", "youtu.be", "t.me",
]);

function hostEtld1(rawUrl: string): string {
  let h = "";
  try {
    h = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
  if (h.startsWith("www.")) h = h.slice(4);
  if (h.startsWith("m.")) h = h.slice(2);
  if (h.startsWith("en.m.")) h = h.slice(5);
  if (h.startsWith("en.")) h = h.slice(3);
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const second = parts[parts.length - 2];
  if (["co", "gov", "com", "org", "net", "ac"].includes(second!) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function normalizeUrl(u: string): string {
  // Strip fragment, lowercase host, drop trailing slash, drop common query junk.
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    // Drop tracking params
    const drop = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"];
    for (const k of drop) parsed.searchParams.delete(k);
    let s = parsed.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// Search backend — FOUR MODES:
//   1. SEARXNG_MODE=legacy (default): old multi-engine fan-out
//      ("google,bing,duckduckgo" + language=en). Cache key "legacy::<query>".
//      Comparable with existing v0..v15 baseline runs.
//   2. SEARXNG_MODE=cycle: new proposed_searxng priority cycle. Cache key
//      "cycle::<query>". Use after suspensions clear.
//   3. SEARXNG_MODE=exa: Exa Search API (own index, no IP rate-limit). Cache
//      key "exa::<query>". Needs EXA_API_KEY.
//   4. SEARXNG_MODE=brave: Brave Search API. Cache key "brave::<query>".
//      Needs BRAVE_API_KEY.
// ---------------------------------------------------------------------------

const SEARXNG_MODE = process.env.SEARXNG_MODE ?? "legacy";
const SEARXNG_URL_LEGACY = process.env.SEARXNG_URL ?? "http://localhost:8080";
const LEGACY_ENGINES = "google,bing,duckduckgo";
const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
// Brave free tier is 1 rps; paid tiers higher. Stay safe by default.
const BRAVE_INTERVAL_MS = Number(process.env.BRAVE_INTERVAL_MS) || 1_100;

import PQueue from "p-queue";
const LEGACY_INTERVAL_MS = Number(process.env.SEARXNG_LEGACY_INTERVAL_MS) || 4_000;
const legacyQueue = new PQueue({ concurrency: 1, interval: LEGACY_INTERVAL_MS, intervalCap: 1 });
const braveQueue = new PQueue({ concurrency: 1, interval: BRAVE_INTERVAL_MS, intervalCap: 1 });

const exaClient = SEARXNG_MODE === "exa"
  ? new Exa(process.env.EXA_API_KEY ?? (() => { throw new Error("EXA_API_KEY missing"); })())
  : null;
const braveKey = SEARXNG_MODE === "brave"
  ? (process.env.BRAVE_API_KEY ?? (() => { throw new Error("BRAVE_API_KEY missing"); })())
  : null;

function cachePath(query: string): string {
  // Per-mode cache prefix so backends don't share entries:
  //   legacy → "google,bing,duckduckgo" (preserves v0..v15 cache)
  //   cycle  → "cycle"
  //   exa    → "exa"
  //   brave  → "brave"
  const prefix = SEARXNG_MODE === "cycle" ? "cycle"
    : SEARXNG_MODE === "exa" ? "exa"
    : SEARXNG_MODE === "brave" ? "brave"
    : "google,bing,duckduckgo";
  const h = crypto.createHash("md5").update(`${prefix}::${query}`).digest("hex");
  return path.join(CACHE_DIR, `${h}.json`);
}

async function exaFetch(query: string): Promise<SearxResult[]> {
  const resp = await exaClient!.search(query, {
    type: "auto",
    numResults: TOP_K_PER_QUERY,
    contents: { highlights: true },
  } as any);
  const seen = new Set<string>();
  const out: SearxResult[] = [];
  for (const r of (resp as any).results ?? []) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    const highlights: string[] = r.highlights ?? [];
    out.push({ title: r.title ?? "", url: r.url, content: highlights.join(" … ") });
    if (out.length >= TOP_K_PER_QUERY) break;
  }
  return out;
}

async function braveFetch(query: string): Promise<SearxResult[]> {
  return (await braveQueue.add(async () => {
    const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=${TOP_K_PER_QUERY}`;
    const resp = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": braveKey!,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`Brave HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
    const data: any = await resp.json();
    const seen = new Set<string>();
    const out: SearxResult[] = [];
    for (const r of data?.web?.results ?? []) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({ title: r.title ?? "", url: r.url, content: r.description ?? "" });
      if (out.length >= TOP_K_PER_QUERY) break;
    }
    return out;
  }))!;
}

async function legacyFetch(query: string, engines: string): Promise<SearxResult[]> {
  const url = `${SEARXNG_URL_LEGACY}/search?q=${encodeURIComponent(query)}&format=json&engines=${engines}&language=en`;
  return (await legacyQueue.add(async () => {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CN-QueryWriterEval/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`SearXNG HTTP ${resp.status}`);
    const data: any = await resp.json();
    const seen = new Set<string>();
    const out: SearxResult[] = [];
    for (const r of data.results ?? []) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({ title: r.title ?? "", url: r.url, content: r.content ?? "" });
      if (out.length >= TOP_K_PER_QUERY) break;
    }
    return out;
  }))!;
}

export async function searchSearxng(
  query: string,
  _opts: { engines?: string; useCache?: boolean } = {},
): Promise<{ results: SearxResult[]; fromCache: boolean }> {
  const useCache = _opts.useCache !== false;
  const cp = cachePath(query);

  if (useCache && fs.existsSync(cp)) {
    try {
      const data = JSON.parse(fs.readFileSync(cp, "utf8"));
      if (Array.isArray(data.results) && data.results.length > 0) {
        return { results: data.results, fromCache: true };
      }
    } catch {}
  }

  let out: SearxResult[];
  if (SEARXNG_MODE === "cycle") {
    const raw = await fetchSearxngProvider(query, _opts.engines ? { engines: _opts.engines } : {});
    const seen = new Set<string>();
    out = [];
    for (const r of raw) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({ title: r.title ?? "", url: r.url, content: r.content ?? "" });
      if (out.length >= TOP_K_PER_QUERY) break;
    }
  } else if (SEARXNG_MODE === "exa") {
    try {
      out = await exaFetch(query);
    } catch (e: any) {
      console.warn(`[exa] query failed: ${e?.message ?? e}`);
      out = [];
    }
  } else if (SEARXNG_MODE === "brave") {
    try {
      out = await braveFetch(query);
    } catch (e: any) {
      console.warn(`[brave] query failed: ${e?.message ?? e}`);
      out = [];
    }
  } else {
    try {
      out = await legacyFetch(query, _opts.engines ?? LEGACY_ENGINES);
    } catch {
      out = [];
    }
  }

  if (out.length > 0) {
    fs.writeFileSync(cp, JSON.stringify({ query, results: out, mode: SEARXNG_MODE }));
  }
  return { results: out, fromCache: false };
}

// ---------------------------------------------------------------------------
// Build the userMessage for a candidate (mirrors production buildUserMessage)
// ---------------------------------------------------------------------------

export function loadInput(tweetId: string): { post: any; botInput: any } {
  const p = path.join(INPUTS_DIR, `${tweetId}.json`);
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  return { post: data.post, botInput: data.botInput };
}

export function buildUserMessageForCandidate(c: Candidate): string {
  const { post, botInput } = loadInput(c.tweet_id);
  return buildUserMessage({
    post,
    tweetMedia: botInput.mediaResult?.tweetMedia ?? [],
    quotedTweetMedia: botInput.mediaResult?.quotedTweetMedia ?? [],
    authorNoteHistory: botInput.authorHistory,
    comments: botInput.comments,
  });
}

// ---------------------------------------------------------------------------
// Run a query writer prompt variant and score one row
// ---------------------------------------------------------------------------

interface QueryWriterCallOpts {
  systemPrompt: string;
  userMessage: string;
  model?: string;
}

async function llmWithRetry(args: any, attempts = 3): Promise<any> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await llm.create(args);
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      if (!/connection|timeout|fetch|ECONN|rate|429|502|503|504/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function callQueryWriter(opts: QueryWriterCallOpts): Promise<{
  queries: string[];
  prompt_tokens?: number;
  completion_tokens?: number;
  raw_content?: string;
}> {
  const response = await llmWithRetry({
    model: opts.model ?? MODEL,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userMessage },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "queries",
        strict: true,
        schema: {
          type: "object",
          properties: {
            queries: { type: "array", items: { type: "string" } },
          },
          required: ["queries"],
          additionalProperties: false,
        },
      },
    } as any,
  });
  const content = response.choices?.[0]?.message?.content ?? "";
  let parsed: { queries: string[] } = { queries: [] };
  try { parsed = JSON.parse(content); } catch {}
  const usage: any = (response as any).usage ?? {};
  return {
    queries: (parsed.queries ?? []).slice(0, MAX_QUERIES),
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    raw_content: content,
  };
}

export type QueryGen = (userMessage: string) => Promise<{
  queries: string[];
  prompt_tokens?: number;
  completion_tokens?: number;
}>;

export async function evaluateRow(
  candidate: Candidate,
  systemPrompt: string,
  opts: { engines?: string; model?: string; queryGen?: QueryGen } = {},
): Promise<RowResult> {
  const refUrls = new Set(candidate.reference_urls.map(normalizeUrl));
  const refDomains = new Set(candidate.reference_domains_all);

  let userMessage = "";
  try {
    userMessage = buildUserMessageForCandidate(candidate);
  } catch (e: any) {
    return {
      tweet_id: candidate.tweet_id,
      primary_category: candidate.primary_category,
      reference_urls: candidate.reference_urls,
      reference_domains: candidate.reference_domains_all,
      user_message_chars: 0,
      queries: [],
      per_query: [],
      all_result_urls: [],
      all_result_domains: [],
      hit_url: false,
      hit_domain: false,
      matched_urls: [],
      matched_domains: [],
      errored: true,
      error_message: `loadInput failed: ${e?.message ?? e}`,
    };
  }

  const t0 = Date.now();
  let writerResult: Awaited<ReturnType<typeof callQueryWriter>>;
  try {
    writerResult = opts.queryGen
      ? await opts.queryGen(userMessage)
      : await callQueryWriter({ systemPrompt, userMessage, model: opts.model });
  } catch (e: any) {
    return {
      tweet_id: candidate.tweet_id,
      primary_category: candidate.primary_category,
      reference_urls: candidate.reference_urls,
      reference_domains: candidate.reference_domains_all,
      user_message_chars: userMessage.length,
      queries: [],
      per_query: [],
      all_result_urls: [],
      all_result_domains: [],
      hit_url: false,
      hit_domain: false,
      matched_urls: [],
      matched_domains: [],
      errored: true,
      error_message: `queryWriter failed: ${e?.message ?? e}`,
    };
  }
  const t1 = Date.now();

  const queries = writerResult.queries;
  const perQuery: QueryRunResult[] = [];
  const allUrls: string[] = [];
  for (const q of queries) {
    try {
      const { results } = await searchSearxng(q, { engines: opts.engines });
      perQuery.push({ query: q, results });
      for (const r of results) allUrls.push(r.url);
    } catch (e: any) {
      perQuery.push({ query: q, results: [], error: e?.message ?? "search failed" });
    }
  }

  const allUrlsNorm = allUrls.map(normalizeUrl);
  const allDomains = allUrls.map(hostEtld1).filter(Boolean);
  const matchedUrls = allUrlsNorm.filter((u) => refUrls.has(u));
  const matchedDomains = allDomains.filter((d) => refDomains.has(d));

  return {
    tweet_id: candidate.tweet_id,
    primary_category: candidate.primary_category,
    reference_urls: candidate.reference_urls,
    reference_domains: candidate.reference_domains_all,
    user_message_chars: userMessage.length,
    prompt_tokens: writerResult.prompt_tokens,
    completion_tokens: writerResult.completion_tokens,
    queries,
    per_query: perQuery,
    all_result_urls: Array.from(new Set(allUrls)),
    all_result_domains: Array.from(new Set(allDomains)),
    hit_url: matchedUrls.length > 0,
    hit_domain: matchedDomains.length > 0,
    matched_urls: Array.from(new Set(matchedUrls)),
    matched_domains: Array.from(new Set(matchedDomains)),
    errored: false,
    llm_call_seconds: (t1 - t0) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Split loading + run a whole split
// ---------------------------------------------------------------------------

export function loadSplit(name: string): Candidate[] {
  const p = path.join(EVAL_ROOT, `${name}.jsonl`);
  return fs
    .readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

export function loadPrompt(variant: string): string {
  const p = path.join(EVAL_ROOT, "prompts", `${variant}.md`);
  return fs.readFileSync(p, "utf8");
}

export async function runSplit(opts: {
  split: string;
  variant: string;
  systemPrompt?: string;
  engines?: string;
  model?: string;
  concurrency?: number;
  limit?: number;
  cacheKeySuffix?: string;
  judge?: boolean;
  queryGen?: QueryGen;
}): Promise<{ rows: RowResult[]; summary: RunSummary }> {
  const candidates = loadSplit(opts.split);
  const limited = opts.limit ? candidates.slice(0, opts.limit) : candidates;
  const systemPrompt = opts.queryGen ? "" : (opts.systemPrompt ?? loadPrompt(opts.variant));

  const concurrency = opts.concurrency ?? 5;
  const queue = new PQueue({ concurrency });

  const rows: RowResult[] = new Array(limited.length);
  let done = 0;
  await Promise.all(
    limited.map((c, i) =>
      queue.add(async () => {
        const r = await evaluateRow(c, systemPrompt, { engines: opts.engines, model: opts.model, queryGen: opts.queryGen });
        rows[i] = r;
        done++;
        if (done % 5 === 0 || done === limited.length) {
          const hits = rows.filter((x) => x?.hit_domain).length;
          console.log(`[${opts.variant}/${opts.split}] ${done}/${limited.length} (hit_domain so far: ${hits})`);
        }
      })
    )
  );

  const summary = summarize(rows, opts.variant, opts.split);
  const runDir = path.join(RUNS_DIR, `${opts.variant}__${opts.split}__${Date.now()}`);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "rows.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n"));
  fs.writeFileSync(path.join(runDir, "system_prompt.md"), systemPrompt);

  if (opts.judge !== false) {
    console.log(`\nJudging ${rows.length} rows with LLM judge...`);
    const { judgeAllRows } = await import("./judgeRows");
    const verdicts = await judgeAllRows(rows);
    const sufficient = verdicts.filter((v) => v.sufficient).length;
    summary.judge_sufficient_pct = 100 * sufficient / rows.length;
    fs.writeFileSync(path.join(runDir, "judge.jsonl"), verdicts.map((v) => JSON.stringify(v)).join("\n"));
    // Per-category judge breakdown
    const byCatJudge: Record<string, { n: number; pass: number }> = {};
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i]!.primary_category ?? "unknown";
      byCatJudge[c] ??= { n: 0, pass: 0 };
      byCatJudge[c].n++;
      if (verdicts[i]?.sufficient) byCatJudge[c].pass++;
    }
    for (const [c, v] of Object.entries(byCatJudge)) {
      if (summary.per_category[c]) {
        summary.per_category[c].judge_sufficient_pct = 100 * v.pass / v.n;
      }
    }
  }

  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${runDir}`);

  printSummary(summary);
  return { rows, summary };
}

export function summarize(rows: RowResult[], variant: string, split: string): RunSummary {
  const n = rows.length;
  const hitUrl = rows.filter((r) => r.hit_url).length;
  const hitDomain = rows.filter((r) => r.hit_domain).length;
  const errored = rows.filter((r) => r.errored).length;
  const queryCounts = rows.map((r) => r.queries.length);
  const emptyQueryRows = queryCounts.filter((c) => c === 0).length;
  const avgQueries = queryCounts.reduce((a, b) => a + b, 0) / Math.max(1, n);

  const byCat: Record<string, { hits_d: number; hits_u: number; n: number }> = {};
  for (const r of rows) {
    const c = r.primary_category ?? "unknown";
    byCat[c] ??= { hits_d: 0, hits_u: 0, n: 0 };
    byCat[c].n++;
    if (r.hit_domain) byCat[c].hits_d++;
    if (r.hit_url) byCat[c].hits_u++;
  }
  const per_category: Record<string, { n: number; hit_domain_pct: number; hit_url_pct: number }> = {};
  for (const [c, v] of Object.entries(byCat)) {
    per_category[c] = {
      n: v.n,
      hit_domain_pct: 100 * v.hits_d / v.n,
      hit_url_pct: 100 * v.hits_u / v.n,
    };
  }

  return {
    variant,
    split,
    n,
    hit_url_pct: 100 * hitUrl / n,
    hit_domain_pct: 100 * hitDomain / n,
    errored,
    avg_queries: avgQueries,
    empty_query_rows: emptyQueryRows,
    per_category,
  };
}

export function printSummary(s: RunSummary): void {
  console.log("");
  console.log(`==== ${s.variant} / ${s.split} (n=${s.n}) ====`);
  if (s.judge_sufficient_pct != null) {
    console.log(`JUDGE sufficient : ${s.judge_sufficient_pct.toFixed(1)}%  <-- primary metric`);
  }
  console.log(`hit_domain : ${s.hit_domain_pct.toFixed(1)}%`);
  console.log(`hit_url    : ${s.hit_url_pct.toFixed(1)}%`);
  console.log(`avg_queries: ${s.avg_queries.toFixed(2)}`);
  console.log(`empty rows : ${s.empty_query_rows}`);
  console.log(`errored    : ${s.errored}`);
  console.log("by category (n / hit_domain / judge):");
  const sorted = Object.entries(s.per_category).sort((a, b) => b[1].n - a[1].n);
  for (const [c, v] of sorted) {
    const j = v.judge_sufficient_pct == null ? "   -" : `${v.judge_sufficient_pct.toFixed(1).padStart(5)}%`;
    console.log(`  ${v.n.toString().padStart(3)}  ${v.hit_domain_pct.toFixed(1).padStart(5)}%  ${j}  ${c}`);
  }
}
