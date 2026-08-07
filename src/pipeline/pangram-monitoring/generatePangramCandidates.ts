/**
 * The Pangram AI-detection pre-pass over the biggest feeds.
 *
 * It runs before the regular pipeline. It crawls the big feed, trying XXL first,
 * then XL, then large. It keeps only the long-form posts we have not checked yet,
 * which are the paid and premium ones. It ranks them by a blend that is mostly
 * views: 70% views, 20% length and 10% recency. It takes the top few and sends
 * each one to Pangram.
 *
 * A post that Pangram calls fully AI-generated becomes a candidate. Its note
 * cites the Pangram report link as its source. The wording of that note is a
 * 50/50 A/B test called PANGRAM_NOTE_TEST. These candidates go through the same
 * submitCandidates path as the regular pipeline, so they share its daily cap and
 * show up in the same dashboards. Every candidate run is tagged with
 * pangram_monitoring=yes.
 *
 * Each post is classified exactly once. Every checked post is recorded in
 * pangram_monitoring_sightings and left out of later crawls, so a viral long-form
 * post is sent to Pangram once instead of on every run. That ledger is separate
 * from the regular pipeline's skip logic, so a Pangram check never makes the
 * regular pipeline skip a post. A post whose classification errored is not
 * recorded, so the next run tries it again.
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
// We rank for reach. Views count most, then length, then recency.
const PANGRAM_SORT_WEIGHTS: SortWeights = { recency: 0.1, length: 0.2, impressions: 0.7 };

const PANGRAM_BOT_ID = "pangram-monitoring";
// X has no tag for AI-generated content. Missing context is the closest fit,
// because the post does not disclose that it was written by an AI. See
// buildPangramNote for the wording of the note itself.
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
  /** The same set generateCandidates uses, so we do not crawl tweets we have
   *  already noted or that are still cooling down. It is not what keeps us from
   *  classifying a post twice. The pangram_monitoring_sightings ledger does
   *  that. */
  skipPostIds: Set<string>;
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
}

/** Tries each feed size in turn and moves on to the next one after any error. It
 *  returns null when every size fails, so a temporary problem with the feed never
 *  breaks the run. */
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
  // We leave evaluationScore unset. Nothing evaluates a Pangram note, so there
  // is no score to compare with the regular candidates. runPipeline puts the
  // Pangram candidates last, so they only use whatever daily cap is left over.
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

/** Builds a result for a post that did not become a candidate. It exists only to
 *  feed the onTweetProcessed hook. No pipeline run row was created for it. */
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

/** Classifies one post. It returns a Candidate only when Pangram says the post is
 *  fully AI-generated and the note we would submit fits within X's length limit.
 *  It returns a sighting for every post that was classified, whether Pangram
 *  called it AI or not. A post whose classification failed gets no sighting, so
 *  the next run tries it again. */
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

  const picks = { pangram_monitoring: "yes", pangram_note: variant, feed_size: feedSize };
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

  // The tweets table needs a row for every pipeline run we may create below.
  // This call only inserts rows that are missing and never overwrites one.
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

  // Recording the checks is what stops a later run from classifying these posts
  // a second time.
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
