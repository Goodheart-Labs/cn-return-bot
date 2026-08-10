/**
 * cheap-bot Orchestrator
 *
 * A five-stage pipeline used to hill-climb the bot against datasets/big_eval.
 *   1-2. Search. This is either the SearXNG chain, which is the query writer,
 *        then the SearXNG fetch, then an optional analyzer, or it is a single
 *        Gemini native-search call. The cheap_bot_native_search A/B test picks
 *        between the two through config.web_search.
 *   3. Note writer. This reuses simple-bot's writer, running on DeepSeek.
 *   4. Note-needed judge. This reuses simple-bot's judge and is always on here.
 *   5. Source verifier. This reuses verify/sourceVerifier, running on DeepSeek.
 *
 * Stages 3 to 5 are reused exactly as they are from simple-bot and verify, so we
 * do not maintain two copies of them. The model for each stage comes from the
 * bot config picks declared in abTestsData.ts, under the cheap-bot variant of
 * BOT_TEST.
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
import { topicSourcelessRejection } from "../utils/noteLint";

const MAX_RESULTS_PER_QUERY = 6;
const MIN_TWEET_TEXT_CHARS = 1; // A shorter post text means a truncated or empty fetch.

export async function runCheapBotPipeline(
  post: Post,
  input: BotInput,
): Promise<PipelineOutcome> {
  const startMs = Date.now();

  /* The writer-output cache lets a run skip straight to the gates. When the
   * WRITER_CACHE directory holds an entry for this post, we replay only the two
   * gates, which are the judge and the verifier, from the cached writer note. A
   * cache miss falls through to the full pipeline, and so does an unset env var.
   * Whenever the env var is set we also write the cache, so the next run can
   * replay. */
  const stage = await withWriterCache(post.id, () => produceWriterOutput(post, input));
  const outcome = stage.kind === "early_exit" ? stage.outcome : await runGates(stage);
  logFinal(startMs);
  return outcome;
}

/** Runs stages 0 to 3. First the satire gate, then the search through
 *  gatherFindings, then the note writer. It returns the writer's note as a
 *  writer_done result, or a terminal early-exit outcome. */
async function produceWriterOutput(post: Post, input: BotInput): Promise<WriterStageResult> {
  const log = getTweetLog();
  const config = getBotConfig();

  /* Some pipeline runs arrive with an empty `post.text`. That is usually a
   * truncated fetch. Sometimes it is a video-only post whose text field was
   * never filled in. The query writer then emits zero queries and the row
   * silently records as "no_correction_needed". We stop here instead, so that
   * analysis can tell this failure mode apart from a real pipeline decision. */
  if (!post.text || post.text.trim().length < MIN_TWEET_TEXT_CHARS) {
    log?.set(`${STEP.root}.skipReason`, "empty_tweet_text");
    return { kind: "early_exit", outcome: { type: "no_correction", reason: "empty_tweet_text: post.text was empty/whitespace — likely a fetch issue, not a pipeline decision" } };
  }

  const userMessage = buildUserMessageFromInput(post, input);

  /* Stage 0 is the optional satire detector. It exits early, before search and
   * the writer, when the post is overt satire the audience is in on.
   * config.satire_detector turns it on. It fails open. A detector error must
   * never suppress a note, so on any failure we log the error and carry on with
   * the normal pipeline instead of aborting the row. */
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

  /* Stages 1 to 2b gather the research findings. The cheap_bot_native_search
   * test picks between two paths. One is the SearXNG chain, which is the query
   * writer, then the fetch, then the analyzer. The other is a single Gemini
   * native-search call. */
  const search = await gatherFindings(userMessage);
  if (search.kind === "early_exit") return search;
  const { findings, queries, snippetsByUrl } = search;

  // Stage 3: writer
  const note = await runWriter(userMessage, findings);

  // The writer signals "no dispute found" by returning an empty note_text. We
  // return no_correction right here, so we do not spend a judge call on it.
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

/** The research findings for the writer. This is either a terminal early-exit,
 *  or the findings brief together with the queries that produced it and one
 *  snippet per URL. The source verifier falls back on those snippets.
 *  Native-gemini search issues no discrete queries and keeps no snippets, so on
 *  that path both come back empty. */
type GatheredFindings =
  | { kind: "early_exit"; outcome: PipelineOutcome }
  | { kind: "ok"; findings: string; queries: string[]; snippetsByUrl: Map<string, Snippet> };

/** Routes the search step on config.web_search. It runs either the SearXNG
 *  chain, which is the query writer, then the fetch, then the analyzer, or a
 *  single Gemini native-search call. */
async function gatherFindings(userMessage: string): Promise<GatheredFindings> {
  return getBotConfig().web_search === "native_gemini"
    ? gatherNativeGeminiFindings(userMessage)
    : gatherSearxngFindings(userMessage);
}

/** The SearXNG path runs the query writer, then the SearXNG fetch, then an
 *  optional analyzer. */
async function gatherSearxngFindings(userMessage: string): Promise<GatheredFindings> {
  const log = getTweetLog();
  const config = getBotConfig();

  // Stage 1: query writer
  const { queries } = await runQueryWriter(userMessage);
  log?.set(`${STEP.queryWriter}.queries`, queries);
  if (queries.length === 0) {
    return { kind: "early_exit", outcome: { type: "no_correction", reason: "query writer returned no queries — post likely opinion or non-checkable" } };
  }

  // Stage 2 is the SearXNG fetch. It makes one request per query and combines
  // the results.
  const { findings: rawFindings, totalResults, exhaustedCount, snippetsByUrl } = await fetchAndFormatSearch(queries);
  log?.set(`${STEP.fetchAndFormatSearch}.findings`, rawFindings.slice(0, 4000));
  log?.set(`${STEP.fetchAndFormatSearch}.resultCount`, totalResults);
  log?.set(`${STEP.fetchAndFormatSearch}.exhaustedCount`, exhaustedCount);

  /* Every query came back with zero hits. There are two very different reasons
   * for that. If every query also exhausted its SearXNG providers, then the
   * search infrastructure failed and we need a retry or a new provider.
   * Otherwise the searches genuinely found nothing and the claim cannot be
   * checked from search at all. We put the two cases in different outcome
   * reasons so that analysis can tell them apart. */
  if (totalResults === 0) {
    const reason = exhaustedCount === queries.length
      ? "searxng_all_providers_exhausted: every SearXNG provider failed for every query — infrastructure failure, not a pipeline decision"
      : "no_evidence_found: every search query returned zero results — refusing to write a note without evidence";
    return { kind: "early_exit", outcome: { type: "no_correction", reason } };
  }

  // Stage 2b is the optional search analyzer. It distills the raw search
  // snippets into a clean research brief written as free text.
  // config.search_analyzer turns it on, and it is off by default.
  const findings = config.search_analyzer ? await runSearchAnalyzer(userMessage, rawFindings) : rawFindings;
  return { kind: "ok", findings, queries, snippetsByUrl };
}

/** The native-gemini path makes one call grounded in googleSearch, and that call
 *  returns the findings brief directly. It replaces the query writer, the
 *  SearXNG fetch, and the analyzer. Gemini issues its own queries, so there are
 *  no discrete queries and no per-URL snippets to carry forward. */
async function gatherNativeGeminiFindings(userMessage: string): Promise<GatheredFindings> {
  // searchWithGeminiNative logs its own input and output under
  // note_writer_steps.search.
  const search = await searchWithGeminiNative(userMessage, COST.search);
  trackLlmCall(search.costEntry);
  if (!search.findings.trim()) {
    return { kind: "early_exit", outcome: { type: "no_correction", reason: "native_gemini_search_empty: Gemini native search returned no findings" } };
  }
  return { kind: "ok", findings: search.findings, queries: [], snippetsByUrl: new Map() };
}

/** Runs stages 4 and 5. First the note-needed judge, then the source verifier,
 *  which gets one revision pass. This runs on every full pipeline and on every
 *  cache replay. */
async function runGates(stage: Extract<WriterStageResult, { kind: "writer_done" }>): Promise<PipelineOutcome> {
  const { userMessage, findings } = stage;
  const snippetsByUrl = new Map(stage.snippets);
  let note: WriterResult = { noteText: stage.noteText, sources: stage.sources };

  // Stage 4 is the note-needed judge. It is always on in cheap-bot, where it is
  // the main guard against false positives.
  const judge = await runNoteNeededJudge({
    postContext: userMessage,
    noteText: note.noteText,
    sources: note.sources,
  });
  if (!judge.noteNeeded) {
    return { type: "no_correction", reason: judge.reasoning };
  }

  /* Stage 5 is the source verifier. A rejection gets one revision pass.
   *
   * Iteration 3 found about five cases where the verifier correctly flagged bad
   * sources, but the good sources on their own would still have made a
   * publishable note. In one case one of three cited URLs was behind a paywall.
   * In another, one claim of a multi-claim note had no support. Rather than
   * dropping the whole row, we give the writer one chance to rewrite using only
   * the good sources and the verifier's reasoning about what went wrong. If the
   * revision fails verification as well, we stop there. There is no loop. */
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
    // A curated-topic note must keep at least one verified source. The classic
    // verifier can accept a note while still classifying every one of its URLs
    // as bad. See topicSourcelessRejection.
    const sourceless = topicSourcelessRejection(verification.good_sources);
    if (sourceless) {
      return {
        type: "verification_failed",
        noteText: note.noteText,
        sources: note.sources,
        reason: sourceless,
        searchResults: findings,
      };
    }
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
  /** Each URL maps to its snippet from the raw SearXNG results. The source
   *  verifier uses these as fallback content when it cannot fetch a cited
   *  URL. */
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

/** Asks the writer to revise a rejected note. The writer may use only the good
 *  sources and the verifier's stated reason. This returns null when the writer
 *  produced no new note, either because the call errored or because it came back
 *  empty. */
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
    /* The revision is best effort. If the writer errors, for example on
     * malformed JSON, we must not crash the whole row. We keep the original note
     * so the row records a clean verification_failed outcome. A bot_error here
     * would be mis-bucketed by the categorizer as a real verifier rejection. */
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
