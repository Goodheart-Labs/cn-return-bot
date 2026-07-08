/**
 * XXL-feed Pangram AI-detection pre-pass.
 *
 * Runs before the regular pipeline. Crawls the big feed (XXL → XL → large),
 * keeps only long-form (paid/premium) posts, ranks them by the normal 80/20
 * recency+views sort, takes the top N, and runs each through Pangram. Posts
 * Pangram calls fully AI-generated become candidates whose fixed note cites the
 * Pangram report link as its source; the rest are recorded as rejected runs.
 *
 * Candidates flow through the same submitCandidates path as the regular pipeline
 * (shared daily cap, dashboards). Each run is tagged pangram_monitoring=yes so
 * the dashboards can isolate this pass.
 *
 * Dedup: the crawl is passed the shared skipPostIds (already-noted + cooling-down
 * tweets), and every checked post gets a pipeline_run — AI ones get noted (→
 * skipped next run), non-AI ones get a rejected run (→ standard 1h/24h cooldown).
 * So a viral long-form post is Pangram-checked at most a few times, not every run.
 */
import PQueue from "p-queue";
import { fetchEligiblePosts, type Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import { buildPostSelection } from "../orchestration/utils/feedSizeStrategy";
import { sortByRecencyAndImpressions } from "../orchestration/utils/tweetSorting";
import type { FeedSize } from "../ab-testing/botConfig";
import type { Candidate } from "../orchestration/submitCandidates";
import type { ProcessTweetResult } from "../orchestration/processTweet";
import type { TweetProcessedEvent } from "../orchestration/generateCandidates";
import { classifyText, isFullyAiGenerated, type PangramVerdict } from "./pangramClient";
import { isLongForm } from "./longFormFilter";
import { buildPangramNote } from "./pangramNote";

const PANGRAM_FEED_SIZES: FeedSize[] = ["xxl", "xl", "large"];
const PANGRAM_MAX_RESULTS = 5000;
const PANGRAM_MAX_PAGES = 100;
const PANGRAM_TOP_N = 10;
const PANGRAM_CONCURRENCY = 4;

const PANGRAM_BOT_ID = "pangram-monitoring";
// X has no AI-generated tag; missing context is the closest fit (the post
// doesn't disclose it's AI-written). See buildPangramNote for the wording.
const PANGRAM_MISLEADING_TAGS = ["missing_important_context"];
const PANGRAM_PICKS = { pangram_monitoring: "yes" };

export interface PangramCandidatesOptions {
  /** Shared with generateCandidates so already-noted / cooling-down tweets are
   *  not re-crawled (and, for the rest, dedupes re-checks across runs). */
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

function selectTopLongForm(posts: Post[]): Post[] {
  const longForm = posts.filter(isLongForm);
  const top = sortByRecencyAndImpressions(longForm).slice(0, PANGRAM_TOP_N);
  console.log(`[pangram] ${posts.length} crawled → ${longForm.length} long-form → checking top ${top.length}`);
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

function rejectedResult(pipelineRunId: string, outcome: "rejected" | "failed", reason: string): ProcessTweetResult {
  return { pipelineResult: null, outcome, outcomeReason: reason, finalStage: "pangram", scores: [], pipelineRunId };
}

async function createRun(logger: SupabaseLogger, post: Post): Promise<string | null> {
  try {
    return await logger.createPipelineRun({
      tweet_id: post.id,
      bot_name: PANGRAM_BOT_ID,
      ab_test_picks: PANGRAM_PICKS,
      commit_sha: process.env.GITHUB_SHA,
    });
  } catch (err) {
    console.warn(`[pangram] createPipelineRun failed for ${post.id}:`, err);
    return null;
  }
}

async function completeRun(logger: SupabaseLogger, runId: string, data: Parameters<SupabaseLogger["completePipelineRun"]>[1]) {
  try {
    await logger.completePipelineRun(runId, { bot_name: PANGRAM_BOT_ID, ab_test_picks: PANGRAM_PICKS, ...data });
  } catch (err) {
    console.warn(`[pangram] completePipelineRun failed for ${runId}:`, err);
  }
}

/** Classify one post, record its run, and return a Candidate iff Pangram says
 *  fully AI-generated (and the note fits). Non-AI → rejected run (cooldown);
 *  Pangram error → failed run (retried next run). The tweetResult is returned
 *  for the onTweetProcessed hook regardless of outcome. */
async function processPost(logger: SupabaseLogger, post: Post): Promise<{ candidate: Candidate | null; tweetResult: ProcessTweetResult }> {
  const runId = await createRun(logger, post);
  if (!runId) return { candidate: null, tweetResult: rejectedResult("", "failed", "no_pipeline_run") };

  const verdict = await classifyText(post.text);
  // Narrowing on the fields (not isFullyAiGenerated) so `dashboardLink` is typed.
  const note = verdict.type === "classified" && verdict.predictionShort === "AI" ? buildPangramNote(verdict.dashboardLink) : null;

  if (note) {
    const tweetResult = candidateResult(runId, note.noteText);
    await completeRun(logger, runId, {
      outcome: "candidate",
      final_stage: "candidate",
      note_text: note.noteText,
      source_url: note.sourceUrl,
      note_status: "AI_GENERATED",
    });
    return {
      candidate: { post, tweetResult, botId: PANGRAM_BOT_ID, misleadingTags: PANGRAM_MISLEADING_TAGS, sourceUrl: note.sourceUrl },
      tweetResult,
    };
  }

  const [outcome, reason] = describeRejection(verdict);
  const tweetResult = rejectedResult(runId, outcome, reason);
  await completeRun(logger, runId, { outcome, outcome_reason: reason, final_stage: "pangram", error_message: rejectionError(verdict) });
  return { candidate: null, tweetResult };
}

function describeRejection(verdict: PangramVerdict): ["rejected" | "failed", string] {
  if (verdict.type === "error") return ["failed", "pangram_error"];
  if (isFullyAiGenerated(verdict)) return ["rejected", "no_pangram_link"]; // AI but link missing / note too long
  return ["rejected", "not_ai_generated"];
}

function rejectionError(verdict: PangramVerdict): string | undefined {
  return verdict.type === "error" ? verdict.error.slice(0, 500) : undefined;
}

export async function generatePangramCandidates(
  logger: SupabaseLogger | null,
  { skipPostIds, onTweetProcessed }: PangramCandidatesOptions,
): Promise<Candidate[]> {
  if (!logger) {
    console.log("[pangram] No Supabase logger; skipping Pangram pre-pass");
    return [];
  }

  const crawl = await crawlFeed(skipPostIds);
  if (!crawl) return [];

  const top = selectTopLongForm(crawl.posts);
  if (!top.length) return [];

  // Populate the tweets table for the runs we're about to create (insert-only).
  try {
    await logger.bulkInsertNewTweets(top);
  } catch (err) {
    console.warn("[pangram] bulkInsertNewTweets failed:", err);
  }

  const queue = new PQueue({ concurrency: PANGRAM_CONCURRENCY });
  const candidates: Candidate[] = [];
  await Promise.all(
    top.map((post) =>
      queue.add(async () => {
        const { candidate, tweetResult } = await processPost(logger, post);
        if (candidate) candidates.push(candidate);
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

  console.log(`[pangram] ${candidates.length} AI-generated candidate(s) of ${top.length} checked`);
  return candidates;
}
