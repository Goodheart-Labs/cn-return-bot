/**
 * cheap-bot Orchestrator
 *
 * 5-stage pipeline for hill-climbing the new bot against datasets/big_eval:
 *   1-2. Search: either the SearXNG chain (query writer → searXNG fetch →
 *        optional analyzer) or a single Gemini native-search call, chosen by
 *        the cheap_bot_native_search A/B test (config.web_search).
 *   3. Note writer   (reuses simple-bot's writer with DeepSeek)
 *   4. Note-needed judge (reuses simple-bot's judge — always on)
 *   5. Source verifier (reuses verify/sourceVerifier with DeepSeek)
 *
 * Stages 3-5 are reused as-is from simple-bot / verify so we're not
 * maintaining two copies of those. The model cascade comes from bot config
 * picks declared in abTestsData.ts (BOT_TEST.cheap-bot variant).
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineOutcome } from "../../bots/types";
import type { BotInput } from "../input/createBotInput";
import { getBotConfig } from "../ab-testing/botConfig";
import { buildUserMessageFromInput } from "../prompts/input/userMessage";
import { fetchSearxngResults, formatSearxngResults, SearxngExhaustedError, type SearxngResult } from "../tool-calling/tools";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, COST } from "../utils/noteWriterSteps";
import { verifySources, type SourceVerification } from "../verify/sourceVerifier";
import { runNoteNeededJudge } from "./judge";
import { runWriter, type WriterResult } from "../simple-bot/writer";
import { searchWithGeminiNative } from "../simple-bot/searchDispatch";
import { trackLlmCall } from "../cost-tracking/costTracker";
import { runQueryWriter } from "./queryWriter";
import { runSatireDetector } from "./satireDetector";
import { readSearchCache, writeSearchCache } from "./searchCache";
import { runSearchAnalyzer } from "./searchAnalyzer";
import { withWriterCache, type WriterStageResult, type Snippet } from "../replay/writerCache";

const MAX_RESULTS_PER_QUERY = 6;
const MIN_TWEET_TEXT_CHARS = 1; // guard against truncated/empty fetches

export async function runCheapBotPipeline(
  post: Post,
  input: BotInput,
): Promise<PipelineOutcome> {
  const startMs = Date.now();

  // Writer-output cache: when WRITER_CACHE is populated, replay just the two
  // gates (judge + verifier) from the cached writer note. Misses (and an unset
  // env var) fall through to the full pipeline; a set env var also writes the
  // cache so the next run can replay.
  const stage = await withWriterCache(post.id, () => produceWriterOutput(post, input));
  const outcome = stage.kind === "early_exit" ? stage.outcome : await runGates(stage);
  logFinal(startMs);
  return outcome;
}

/** Stages 0-3: satire gate → search (via gatherFindings) → note writer.
 *  Returns the writer's note (writer_done) or a terminal early-exit outcome. */
async function produceWriterOutput(post: Post, input: BotInput): Promise<WriterStageResult> {
  const log = getTweetLog();
  const config = getBotConfig();

  // Empty-tweet guard. We've seen pipeline runs where `post.text` is "" —
  // usually a truncated fetch, sometimes a video-only post whose text field
  // wasn't populated. The query writer then emits zero queries and the row
  // silently records as "no_correction_needed". Surface this as an explicit
  // failure mode so it's distinguishable in analysis.
  if (!post.text || post.text.trim().length < MIN_TWEET_TEXT_CHARS) {
    log?.set(`${STEP.root}.skipReason`, "empty_tweet_text");
    return { kind: "early_exit", outcome: { type: "no_correction", reason: "empty_tweet_text: post.text was empty/whitespace — likely a fetch issue, not a pipeline decision" } };
  }

  const userMessage = buildUserMessageFromInput(post, input);

  // Stage 0 (optional): satire detector — early-exit before search/writer when
  // the post is overt satire the audience is in on. Gated by config.satire_detector.
  // Fail open: a detector error must never suppress a note, so on any failure we
  // log it and fall through to the normal pipeline rather than aborting the row.
  if (config.satire_detector) {
    try {
      const satire = await runSatireDetector(userMessage);
      if (satire.isSatire) {
        log?.set(`${STEP.satireDetector}.skipped`, true);
        return { kind: "early_exit", outcome: { type: "no_correction", reason: `satire_detected: ${satire.reasoning}` } };
      }
    } catch (err: any) {
      log?.set(`${STEP.satireDetector}.error`, err?.message ?? "unknown");
    }
  }

  // Stages 1-2b: gather research findings. The cheap_bot_native_search test
  // picks between the SearXNG chain (query writer → fetch → analyzer) and a
  // single Gemini native-search call.
  const search = await gatherFindings(userMessage);
  if (search.kind === "early_exit") return search;
  const { findings, queries, snippetsByUrl } = search;

  // Stage 3: writer
  const note = await runWriter(userMessage, findings);

  // Writer signals "no dispute found" by returning empty note_text. Short-
  // circuit to no_correction without spending a judge call.
  if (!note.noteText.trim()) {
    log?.set(`${STEP.noteWriter}.empty`, true);
    return { kind: "early_exit", outcome: { type: "no_correction", reason: "writer_returned_empty: no dispute found in research findings" } };
  }

  return {
    kind: "writer_done",
    userMessage,
    findings,
    queries,
    noteText: note.noteText,
    sources: note.sources,
    snippets: [...snippetsByUrl.entries()],
  };
}

/** Research findings for the writer: a terminal early-exit, or the findings
 *  brief + the queries that produced it + per-URL snippets (verifier fallback).
 *  Native-gemini search has no discrete queries and no snippets, so those come
 *  back empty. */
type GatheredFindings =
  | { kind: "early_exit"; outcome: PipelineOutcome }
  | { kind: "ok"; findings: string; queries: string[]; snippetsByUrl: Map<string, Snippet> };

/** Route the search step by config.web_search: the SearXNG chain (query writer
 *  → fetch → analyzer) or a single Gemini native-search call. */
async function gatherFindings(userMessage: string): Promise<GatheredFindings> {
  return getBotConfig().web_search === "native_gemini"
    ? gatherNativeGeminiFindings(userMessage)
    : gatherSearxngFindings(userMessage);
}

/** SearXNG path: query writer → searXNG fetch → optional analyzer. */
async function gatherSearxngFindings(userMessage: string): Promise<GatheredFindings> {
  const log = getTweetLog();
  const config = getBotConfig();

  // Stage 1: query writer
  const { queries } = await runQueryWriter(userMessage);
  log?.set(`${STEP.queryWriter}.queries`, queries);
  if (queries.length === 0) {
    return { kind: "early_exit", outcome: { type: "no_correction", reason: "query writer returned no queries — post likely opinion or non-checkable" } };
  }

  // Stage 2: searXNG fetch — one request per query, combined.
  const { findings: rawFindings, totalResults, exhaustedCount, snippetsByUrl } = await fetchAndFormatSearch(queries);
  log?.set(`${STEP.fetchAndFormatSearch}.findings`, rawFindings.slice(0, 4000));
  log?.set(`${STEP.fetchAndFormatSearch}.resultCount`, totalResults);
  log?.set(`${STEP.fetchAndFormatSearch}.exhaustedCount`, exhaustedCount);

  // No-findings guard: if every query returned zero hits AND those zeros
  // weren't legitimate (some/all providers exhausted), this is search
  // infrastructure failing, not "no story to write about". Distinguish the
  // two failure modes in the outcome reason so analysis can separate
  // "provider failure → need retry / new provider" from "claim genuinely
  // unverifiable from search".
  if (totalResults === 0) {
    const reason = exhaustedCount === queries.length
      ? "searxng_all_providers_exhausted: every SearXNG provider failed for every query — infrastructure failure, not a pipeline decision"
      : "no_evidence_found: every search query returned zero results — refusing to write a note without evidence";
    return { kind: "early_exit", outcome: { type: "no_correction", reason } };
  }

  // Stage 2b (optional): search analyzer — distill raw search snippets into a
  // clean free-text research brief. Gated by config.search_analyzer (default off).
  const findings = config.search_analyzer ? await runSearchAnalyzer(userMessage, rawFindings) : rawFindings;
  return { kind: "ok", findings, queries, snippetsByUrl };
}

/** Native-gemini path: one googleSearch-grounded call returns the findings
 *  brief directly, replacing the query writer + searXNG fetch + analyzer.
 *  Gemini issues its own queries, so there are no discrete queries or per-URL
 *  snippets to carry forward. */
async function gatherNativeGeminiFindings(userMessage: string): Promise<GatheredFindings> {
  // searchWithGeminiNative logs its own input/output under note_writer_steps.search.
  const search = await searchWithGeminiNative(userMessage, COST.search);
  trackLlmCall(search.costEntry);
  if (!search.findings.trim()) {
    return { kind: "early_exit", outcome: { type: "no_correction", reason: "native_gemini_search_empty: Gemini native search returned no findings" } };
  }
  return { kind: "ok", findings: search.findings, queries: [], snippetsByUrl: new Map() };
}

/** Stages 4-5: note-needed judge → source verifier (with one revision pass).
 *  Runs on every full pipeline and on every cache replay. */
async function runGates(stage: Extract<WriterStageResult, { kind: "writer_done" }>): Promise<PipelineOutcome> {
  const { userMessage, findings } = stage;
  const snippetsByUrl = new Map(stage.snippets);
  let note: WriterResult = { noteText: stage.noteText, sources: stage.sources };

  // Stage 4: note-needed judge (always on in cheap-bot — primary FP guard)
  const judge = await runNoteNeededJudge({
    postContext: userMessage,
    noteText: note.noteText,
    sources: note.sources,
  });
  if (!judge.noteNeeded) {
    return { type: "no_correction", reason: judge.reasoning };
  }

  // Stage 5: source verifier — with one revision pass on reject.
  //
  // iter-3 found ~5 cases where the verifier correctly flagged bad sources
  // (e.g. one of three cited URLs was a paywall, or one claim in a multi-claim
  // note wasn't supported) but the good_sources alone would have been a
  // publishable note. Rather than dropping the whole row, we give the writer
  // one chance to rewrite using only the good_sources + the verifier's
  // reasoning about what went wrong. If the revision still fails verification,
  // we stop — no infinite loop.
  let verification = await verifySources({
    noteText: note.noteText,
    sources: note.sources,
    postContext: userMessage,
    snippetsByUrl,
    turnNumber: 1,
  });

  if (!verification.accepted) {
    const revisedNote = await tryWriterRevision(userMessage, findings, note, verification);
    if (revisedNote) {
      note = revisedNote;
      verification = await verifySources({
        noteText: note.noteText,
        sources: note.sources,
        postContext: userMessage,
        snippetsByUrl,
        turnNumber: 2,
      });
    }
  }

  if (verification.accepted) {
    return { type: "note", noteText: note.noteText, sources: verification.good_sources, searchResults: findings };
  }
  return {
    type: "verification_failed",
    noteText: note.noteText,
    sources: note.sources,
    reason: verification.reasoning,
    searchResults: findings,
  };
}

interface SearchOutput {
  findings: string;
  totalResults: number;
  exhaustedCount: number;
  /** URL → snippet from raw SearXNG results. Used as fallback content when
   *  the source verifier can't fetch a cited URL. */
  snippetsByUrl: Map<string, Snippet>;
}

async function fetchAndFormatSearch(queries: string[]): Promise<SearchOutput> {
  const sections: string[] = [];
  let totalResults = 0;
  let exhaustedCount = 0;
  const snippetsByUrl = new Map<string, Snippet>();

  for (const q of queries) {
    const cached = readSearchCache(q);
    let results: SearxngResult[];

    if (cached) {
      results = cached;
    } else {
      try {
        results = await fetchSearxngResults(q);
      } catch (err: any) {
        if (err instanceof SearxngExhaustedError) {
          exhaustedCount++;
          sections.push(`## Query: ${q}\n(searxng exhausted: ${err.message})`);
        } else {
          sections.push(`## Query: ${q}\n(error: ${err?.message ?? "unknown"})`);
        }
        continue;
      }
      writeSearchCache(q, results);
    }

    const top = results.slice(0, MAX_RESULTS_PER_QUERY);
    totalResults += top.length;
    sections.push(`## Query: ${q}\n${formatSearxngResults(top)}`);

    for (const r of top) {
      if (!snippetsByUrl.has(r.url)) {
        snippetsByUrl.set(r.url, { title: r.title, snippet: r.content });
      }
    }
  }
  return { findings: sections.join("\n\n"), totalResults, exhaustedCount, snippetsByUrl };
}

/** When the verifier rejects a note, ask the writer to revise using only the
 *  good_sources + the verifier's stated reason. Returns null when the writer
 *  couldn't (or wouldn't) produce a new note. */
async function tryWriterRevision(
  userMessage: string,
  findings: string,
  originalNote: WriterResult,
  verification: SourceVerification,
): Promise<WriterResult | null> {
  const log = getTweetLog();
  log?.set(`${STEP.sourceVerifier}.revision.attempted`, true);
  log?.set(`${STEP.sourceVerifier}.revision.input`, {
    originalNote: originalNote.noteText,
    originalSources: originalNote.sources,
    good_sources: verification.good_sources,
    bad_sources: verification.bad_sources,
    verifierReason: verification.reasoning,
  });

  const revisionPrompt = [
    findings,
    ``,
    `## Verifier feedback on your previous attempt`,
    `You proposed this note:`,
    `"${originalNote.noteText}"`,
    `cited sources: ${originalNote.sources.join(", ") || "(none)"}`,
    ``,
    `The source verifier rejected it. Reason: ${verification.reasoning}`,
    `Good sources (supported the note's claims): ${verification.good_sources.join(", ") || "(none)"}`,
    `Bad sources (did NOT support the note's claims): ${verification.bad_sources.join(", ") || "(none)"}`,
    ``,
    `Revise the note so every claim it makes is directly supported by the GOOD sources only. Drop or weaken any claim that only relied on a bad source. If the good sources alone cannot support any meaningful dispute of the tweet, return an empty note.`,
  ].join("\n");

  let revised: WriterResult;
  try {
    revised = await runWriter(userMessage, revisionPrompt);
  } catch (err: any) {
    // A revision is best-effort: if the writer errors (e.g. malformed JSON),
    // don't crash the whole row — keep the original note so the row records a
    // clean verification_failed outcome instead of a bot_error that the
    // categorizer would mis-bucket as a legitimate verifier rejection.
    log?.set(`${STEP.sourceVerifier}.revision.outcome`, `writer_error: ${err?.message ?? "unknown"}`);
    return null;
  }
  if (!revised.noteText.trim()) {
    log?.set(`${STEP.sourceVerifier}.revision.outcome`, "writer_returned_empty");
    return null;
  }
  log?.set(`${STEP.sourceVerifier}.revision.outcome`, { noteText: revised.noteText, sources: revised.sources });
  return revised;
}

function logFinal(startMs: number): void {
  const log = getTweetLog();
  log?.set(`${STEP.root}.totalDurationMs`, Date.now() - startMs);
}
