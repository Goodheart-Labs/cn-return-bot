/**
 * XXL-feed Pangram AI-detection pre-pass.
 *
 * Runs before the regular pipeline. Crawls the big feed (XXL → XL → large),
 * keeps only long-form (paid/premium) posts we haven't checked yet, ranks them
 * by a views-weighted blend (70% views, 20% length, 10% recency), takes the top
 * N, and runs each through Pangram. Posts Pangram calls fully AI-generated become candidates whose note
 * cites the Pangram report link as its source (wording is a 50/50 A/B test,
 * PANGRAM_NOTE_TEST). Candidates flow through the same submitCandidates path as
 * the regular pipeline (shared daily cap, dashboards); each candidate run is
 * tagged pangram_monitoring=yes.
 *
 * Dedup (exactly-once): every checked post is recorded in
 * pangram_monitoring_sightings and excluded from future crawls — so a viral
 * long-form post is Pangram-classified once, not every run. That ledger is
 * disjoint from the regular skip logic, so a Pangram check never makes the
 * regular pipeline skip a post. Errors are NOT recorded, so they retry.
 */
import PQueue from "p-queue";
import { fetchEligiblePosts, type Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import { buildPostSelection, type FeedSize } from "../orchestration/utils/feedSizeStrategy";
import { ageInHours, formatCount, sortByWeightedScore, type SortWeights } from "../orchestration/utils/tweetSorting";
import { pickVariantName } from "../ab-testing/abTests";
import { PANGRAM_NOTE_TEST } from "../ab-testing/abTestsData";
import type { Candidate } from "../orchestration/submitCandidates";
import type { ProcessTweetResult } from "../orchestration/processTweet";
import type { TweetProcessedEvent } from "../orchestration/generateCandidates";
import { classifyText } from "./pangramClient";
import { isLongForm } from "./longFormFilter";
import { buildPangramNote, type PangramNoteVariant } from "./pangramNote";

const PANGRAM_FEED_SIZES: FeedSize[] = ["xxl", "xl", "large"];
const PANGRAM_MAX_RESULTS = 5000;
const PANGRAM_MAX_PAGES = 100;
const PANGRAM_TOP_N = 10;
const PANGRAM_CONCURRENCY = 4;
// Prioritize reach: rank long-form posts mostly by views, then length, then recency.
const PANGRAM_SORT_WEIGHTS: SortWeights = { recency: 0.1, length: 0.2, impressions: 0.7 };

const PANGRAM_BOT_ID = "pangram-monitoring";
// X has no AI-generated tag; missing context is the closest fit (the post
// doesn't disclose it's AI-written). See buildPangramNote for the wording.
const PANGRAM_MISLEADING_TAGS = ["missing_important_context"];

type PangramSighting = {
  tweet_id: string;
  feed_size: string;
  impression_count?: number;
  author_name?: string;
  prediction_short: string;
  fraction_ai: number;
  is_ai: boolean;
  processed_run_id?: string;
};

export interface PangramCandidatesOptions {
  /** Shared with generateCandidates so already-noted / cooling-down tweets are
   *  not re-crawled. (Exactly-once dedup is handled separately via the
   *  pangram_monitoring_sightings ledger.) */
  skipPostIds: Set<string>;
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
}

/** Try each feed size in turn; on any error fall through to the next. Returns
 *  null (fail-soft) if all sizes fail, so a feed blip never breaks the run. */
async function crawlFeed(skipPostIds: Set<string>): Promise<{ feedSize: FeedSize; posts: Post[] } | null> {
  for (const size of PANGRAM_FEED_SIZES) {
    try {
      const posts = await fetchEligiblePosts(PANGRAM_MAX_RESULTS, skipPostIds, PANGRAM_MAX_PAGES, buildPostSelection(size));
      console.log(`[pangram] Crawled ${posts.length} posts from ${size} feed`);
      return { feedSize: size, posts };
    } catch (err) {
      console.warn(`[pangram] Feed ${size} failed (${(err as Error)?.message}); trying next`);
    }
  }
  console.warn("[pangram] All feed sizes failed; skipping pre-pass");
  return null;
}

function logSelectedPosts(posts: Post[]): void {
  for (const [i, post] of posts.entries()) {
    const imp = post.public_metrics?.impression_count ?? 0;
    const chars = post.text?.length ?? 0;
    const age = ageInHours(post);
    console.log(`[pangram]   #${i + 1}: ${post.id} | ${formatCount(imp)} imp | ${chars} chars | ${age.toFixed(1)}h ago`);
  }
}

function selectTopLongForm(posts: Post[], checkedIds: Set<string>): Post[] {
  const longForm = posts.filter((p) => isLongForm(p) && !checkedIds.has(p.id));
  const top = sortByWeightedScore(longForm, PANGRAM_SORT_WEIGHTS).slice(0, PANGRAM_TOP_N);
  console.log(`[pangram] ${posts.length} crawled → ${longForm.length} long-form & unchecked → checking top ${top.length}`);
  logSelectedPosts(top);
  return top;
}

function candidateResult(pipelineRunId: string, noteText: string): ProcessTweetResult {
  // evaluationScore left unset → submitCandidates sorts these after the
  // eval-scored regular candidates (they use whatever daily cap is left).
  return {
    pipelineResult: null,
    outcome: "candidate",
    finalStage: "candidate",
    noteStatus: "AI_GENERATED",
    noteText,
    scores: [],
    pipelineRunId,
  };
}

/** A non-candidate result, only used for the onTweetProcessed hook (no run created). */
function syntheticResult(outcome: "rejected" | "failed", reason: string): ProcessTweetResult {
  return { pipelineResult: null, outcome, outcomeReason: reason, finalStage: "pangram", scores: [], pipelineRunId: null };
}

async function createRun(logger: SupabaseLogger, post: Post, picks: Record<string, string>): Promise<string | null> {
  try {
    return await logger.createPipelineRun({
      tweet_id: post.id,
      bot_name: PANGRAM_BOT_ID,
      ab_test_picks: picks,
      commit_sha: process.env.GITHUB_SHA,
    });
  } catch (err) {
    console.warn(`[pangram] createPipelineRun failed for ${post.id}:`, err);
    return null;
  }
}

type PostOutcome = { candidate: Candidate | null; tweetResult: ProcessTweetResult; sighting: PangramSighting | null };

/** Classify one post; return a Candidate iff Pangram says fully AI-generated
 *  (and the note fits). Records a sighting for every classified post (AI or
 *  not); errors return no sighting so they're retried next run. */
async function processPost(logger: SupabaseLogger, post: Post, feedSize: FeedSize): Promise<PostOutcome> {
  const verdict = await classifyText(post.text);
  if (verdict.type === "error") {
    console.warn(`[pangram] classify failed for ${post.id}: ${verdict.error}`);
    return { candidate: null, tweetResult: syntheticResult("failed", "pangram_error"), sighting: null };
  }

  const isAi = verdict.predictionShort === "AI";
  const sighting: PangramSighting = {
    tweet_id: post.id,
    feed_size: feedSize,
    impression_count: post.public_metrics?.impression_count,
    author_name: post.author_name,
    prediction_short: verdict.predictionShort,
    fraction_ai: verdict.fractionAi,
    is_ai: isAi,
  };
  if (!isAi) return { candidate: null, tweetResult: syntheticResult("rejected", "not_ai_generated"), sighting };

  const variant = pickVariantName(PANGRAM_NOTE_TEST) as PangramNoteVariant;
  const note = buildPangramNote(verdict.dashboardLink, variant);
  if (!note) return { candidate: null, tweetResult: syntheticResult("rejected", "no_pangram_note"), sighting };

  const picks = { pangram_monitoring: "yes", pangram_note: variant };
  const runId = await createRun(logger, post, picks);
  if (!runId) return { candidate: null, tweetResult: syntheticResult("failed", "no_pipeline_run"), sighting };

  try {
    await logger.completePipelineRun(runId, {
      outcome: "candidate",
      final_stage: "candidate",
      bot_name: PANGRAM_BOT_ID,
      ab_test_picks: picks,
      note_text: note.noteText,
      source_url: note.sourceUrl,
      note_status: "AI_GENERATED",
    });
  } catch (err) {
    console.warn(`[pangram] completePipelineRun failed for ${runId}:`, err);
  }

  sighting.processed_run_id = runId;
  const tweetResult = candidateResult(runId, note.noteText);
  return {
    candidate: { post, tweetResult, botId: PANGRAM_BOT_ID, misleadingTags: PANGRAM_MISLEADING_TAGS, sourceUrl: note.sourceUrl },
    tweetResult,
    sighting,
  };
}

export async function generatePangramCandidates(
  logger: SupabaseLogger | null,
  { skipPostIds, onTweetProcessed }: PangramCandidatesOptions,
): Promise<Candidate[]> {
  if (!logger) {
    console.log("[pangram] No Supabase logger; skipping Pangram pre-pass");
    return [];
  }

  const checkedIds = await logger.getPangramCheckedTweetIds();
  const crawl = await crawlFeed(skipPostIds);
  if (!crawl) return [];

  const top = selectTopLongForm(crawl.posts, checkedIds);
  if (!top.length) return [];

  // Populate the tweets table for the runs we may create (insert-only).
  try {
    await logger.bulkInsertNewTweets(top);
  } catch (err) {
    console.warn("[pangram] bulkInsertNewTweets failed:", err);
  }

  const queue = new PQueue({ concurrency: PANGRAM_CONCURRENCY });
  const candidates: Candidate[] = [];
  const sightings: PangramSighting[] = [];
  await Promise.all(
    top.map((post) =>
      queue.add(async () => {
        const { candidate, tweetResult, sighting } = await processPost(logger, post, crawl.feedSize);
        if (candidate) candidates.push(candidate);
        if (sighting) sightings.push(sighting);
        if (onTweetProcessed) {
          try {
            await onTweetProcessed({ post, tweetResult, log: new Map(), botId: PANGRAM_BOT_ID });
          } catch (err) {
            console.warn("[pangram] onTweetProcessed hook failed:", err);
          }
        }
      }),
    ),
  );

  // Record checks so these posts are never re-classified (exactly-once).
  try {
    await logger.recordPangramChecks(sightings);
  } catch (err) {
    console.warn("[pangram] recordPangramChecks failed:", err);
  }

  console.log(
    `[pangram] ${candidates.length} AI candidate(s) of ${top.length} checked (${top.length - sightings.length} errors)`,
  );
  return candidates;
}
