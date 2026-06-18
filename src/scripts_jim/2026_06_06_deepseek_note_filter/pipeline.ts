/**
 * Deepseek note-filter pipeline. Reuses the cheap-bot steps (query writer →
 * SearXNG → search analyzer) plus a reframed note-needed judge, all on
 * deepseek-v4-flash. No note-writing, no source verification.
 *
 * Four variants (2x2): {neutral, lenient} judge  ×  {base, select}.
 *   - base   : analyzer reads the raw SearXNG snippets (like cheap-bot).
 *   - select : an extra step picks the relevant/diverse sources, fetches their
 *              FULL pages, and the analyzer reads those instead.
 *
 * For one tweet all four variants share the SAME query-gen + SearXNG results,
 * and the two analyzer briefs (base / select) are each computed once, so the
 * comparison is apples-to-apples and cheap. Each variant's `costUsd` is the
 * STANDALONE cost of running that filter (it includes the shared upstream).
 */
import type { Post } from "../../api/fetchEligiblePosts";
import { withBotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker, getCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { buildUserMessageFromInput } from "../../pipeline/input/prompt";
import { createBotInput } from "../../pipeline/input/createBotInput";
import { runQueryWriter } from "../../pipeline/cheap-bot/queryWriter";
import { runSearchAnalyzer } from "../../pipeline/cheap-bot/searchAnalyzer";
import {
  fetchSearxngResults,
  formatSearxngResults,
  handleWebFetch,
  type SearxngResult,
} from "../../pipeline/tool-calling/tools";
import { FILTER_CONFIG } from "./config";
import { runFilterJudge, type Leniency } from "./judge";
import { selectSources, type Candidate } from "./sourceSelect";

const MAX_RESULTS_PER_QUERY = 6;
const MAX_SOURCES_TO_FETCH = 5;
const MAX_PAGE_CHARS = 4000; // cap each full-page fetch fed to the analyzer
const FETCH_CONCURRENCY = 4;
// deepseek-v4-flash's query writer is non-deterministic even at temp 0: the same
// post flips between [] and real queries run-to-run. A single flaky [] would
// silently early-exit as "no note needed", so re-roll ONLY on empty, stop the
// instant we get queries, and accept "no queries" only after this many empties.
const QUERY_WRITER_MAX_ATTEMPTS = 3;

export interface VariantSpec {
  key: string;
  leniency: Leniency;
  sourceSelect: boolean;
}

export const VARIANTS: VariantSpec[] = [
  { key: "base-neutral", leniency: "neutral", sourceSelect: false },
  { key: "base-lenient", leniency: "lenient", sourceSelect: false },
  { key: "select-neutral", leniency: "neutral", sourceSelect: true },
  { key: "select-lenient", leniency: "lenient", sourceSelect: true },
];

export interface DatasetRow {
  runId: string;
  tweetId: string;
  tweetUrl: string;
  label: "wants_note" | "no_note";
  outcome: string;
  outcomeReason: string | null;
  tweetText: string | null;
}

export interface RowResult {
  variant: string;
  runId: string;
  tweetId: string;
  tweetUrl: string;
  label: "wants_note" | "no_note";
  outcome: string;
  outcomeReason: string | null;
  tweetText: string | null;
  predNeedsNote: boolean | null;
  predReason: string;
  queries: string[];
  queryAttempts: number; // how many query-writer rolls until non-empty (retry-on-empty)
  numCandidates: number;
  numSelected: number;
  numFetched: number;
  fullInputChars: number;
  costUsd: number | null;
  error?: string;
}

/** Sum of all LLM costs recorded in the active cost-tracker context. */
function costNow(): number {
  return getCostTracker().reduce((s, e) => s + (e.cost ?? 0), 0);
}

// In-process SearXNG cache keyed by query — the same tweet across variants (and
// repeated queries) reuses results instead of re-hitting the search providers.
const searchCache = new Map<string, SearxngResult[]>();

async function searchQuery(q: string): Promise<SearxngResult[]> {
  const cached = searchCache.get(q);
  if (cached) return cached;
  let results: SearxngResult[] = [];
  try {
    results = await fetchSearxngResults(q);
  } catch {
    results = [];
  }
  searchCache.set(q, results);
  return results;
}

interface Gathered {
  formattedSnippets: string;
  candidates: Candidate[];
}

async function gatherSearxng(queries: string[]): Promise<Gathered> {
  const sections: string[] = [];
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const top = (await searchQuery(q)).slice(0, MAX_RESULTS_PER_QUERY);
    sections.push(`## Query: ${q}\n${formatSearxngResults(top)}`);
    for (const r of top) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      candidates.push({ url: r.url, title: r.title, snippet: r.content });
    }
  }
  return { formattedSnippets: sections.join("\n\n"), candidates };
}

async function fetchFullPages(urls: string[]): Promise<{ findings: string; fetched: number }> {
  const out: { url: string; content: string }[] = new Array(urls.length);
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const i = idx++;
      const url = urls[i];
      try {
        const res = await handleWebFetch(url);
        const content = typeof res.output === "string" ? res.output : JSON.stringify(res.output);
        const failed = content.startsWith("Fetch failed:") || content.startsWith("Fetch error:");
        out[i] = { url, content: failed ? "" : content.slice(0, MAX_PAGE_CHARS) };
      } catch {
        out[i] = { url, content: "" };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, urls.length) }, worker));
  const ok = out.filter((p) => p && p.content);
  const findings = ok.map((p) => `### ${p.url}\n${p.content}`).join("\n\n");
  return { findings, fetched: ok.length };
}

/** Query writer with retry-on-empty: re-roll only while it returns [], stop on
 *  the first non-empty result, give up after QUERY_WRITER_MAX_ATTEMPTS. */
async function runQueryWriterRetryOnEmpty(
  userMessage: string,
): Promise<{ queries: string[]; attempts: number }> {
  let queries: string[] = [];
  let attempts = 0;
  while (attempts < QUERY_WRITER_MAX_ATTEMPTS) {
    attempts++;
    queries = (await runQueryWriter(userMessage)).queries;
    if (queries.length > 0) break;
  }
  return { queries, attempts };
}

/** Run all 4 variants for one row, sharing input-build + query-gen + search +
 *  each analyzer. `post` is the original tweet (reconstructed from the run's
 *  logs); createBotInput recomputes the full input (media analysis, comments,
 *  author history) fresh, so the filter sees exactly what simple-bot saw. */
export async function runRowAllVariants(row: DatasetRow, post: Post): Promise<RowResult[]> {
  const base = {
    runId: row.runId,
    tweetId: row.tweetId,
    tweetUrl: row.tweetUrl,
    label: row.label,
    outcome: row.outcome,
    outcomeReason: row.outcomeReason,
    tweetText: row.tweetText,
  };

  return withCostTracker(() =>
    withBotConfig(FILTER_CONFIG, async () => {
      let fullInputChars = 0;
      let queryAttempts = 0;
      // Helper to emit the same early-exit decision for all 4 variants.
      const allVariants = (
        pred: boolean | null,
        reason: string,
        extra: Partial<RowResult>,
      ): RowResult[] =>
        VARIANTS.map((v) => ({
          ...base,
          variant: v.key,
          predNeedsNote: pred,
          predReason: reason,
          queries: extra.queries ?? [],
          queryAttempts,
          numCandidates: extra.numCandidates ?? 0,
          numSelected: 0,
          numFetched: 0,
          fullInputChars,
          costUsd: costNow(),
          error: extra.error,
        }));

      try {
        // Stage 0: full input — media analysis, comments, author history.
        const input = await createBotInput(post, row.tweetId);
        const userMessage = buildUserMessageFromInput(post, input);
        fullInputChars = userMessage.length;

        // Stage 1: query writer (shared), retry-on-empty. Still empty after all
        // attempts => opinion/joke/non-checkable => no note.
        const qw = await runQueryWriterRetryOnEmpty(userMessage);
        queryAttempts = qw.attempts;
        const queries = qw.queries;
        if (queries.length === 0) {
          return allVariants(
            false,
            `query writer returned no queries after ${qw.attempts} attempts — opinion/joke/non-checkable`,
            { queries },
          );
        }

        // Stage 2: SearXNG (shared).
        const { formattedSnippets, candidates } = await gatherSearxng(queries);
        if (candidates.length === 0) {
          return allVariants(false, "no_evidence_found — every query returned zero results", { queries });
        }
        const costAfterSearch = costNow(); // = query-gen cost (search is free/local)

        // Stage 3a: base analyzer over raw snippets (shared by both base variants).
        const baseFindings = await runSearchAnalyzer(userMessage, formattedSnippets);
        const baseAnalyzerCost = costNow() - costAfterSearch;

        // Stage 3b: select path — pick sources, fetch full pages, analyze those.
        const selected = await selectSources(userMessage, candidates, MAX_SOURCES_TO_FETCH);
        const { findings: pageFindings, fetched } = await fetchFullPages(selected);
        const selectFindings = fetched > 0 ? await runSearchAnalyzer(userMessage, pageFindings) : baseFindings;
        const selectExtraCost = costNow() - costAfterSearch - baseAnalyzerCost;

        // Stage 4: per-variant judge.
        const results: RowResult[] = [];
        for (const v of VARIANTS) {
          const findings = v.sourceSelect ? selectFindings : baseFindings;
          const before = costNow();
          const judge = await runFilterJudge(userMessage, findings, v.leniency);
          const judgeCost = costNow() - before;
          const standaloneCost =
            costAfterSearch + (v.sourceSelect ? selectExtraCost : baseAnalyzerCost) + judgeCost;
          results.push({
            ...base,
            variant: v.key,
            predNeedsNote: judge.needsNote,
            predReason: judge.reasoning,
            queries,
            queryAttempts,
            numCandidates: candidates.length,
            numSelected: v.sourceSelect ? selected.length : 0,
            numFetched: v.sourceSelect ? fetched : 0,
            fullInputChars,
            costUsd: standaloneCost,
          });
        }
        return results;
      } catch (err: any) {
        return allVariants(null, "", { error: err?.message?.slice(0, 300) ?? String(err) });
      }
    }),
  );
}
