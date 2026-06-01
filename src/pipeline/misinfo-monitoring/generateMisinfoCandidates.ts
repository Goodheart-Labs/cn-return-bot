/**
 * XXL-feed misinfo-monitoring pre-pass.
 *
 * Runs before the regular pipeline. Crawls the big feed (XXL → XL → large),
 * keyword-matches posts against the fixed misinfo topics, asks a selection LLM
 * which matched posts actually carry a misleading claim, and processes those
 * first — injecting the topic's ground-truth article into the bot's research
 * step (via MonitoringContext) so the resulting note is well-sourced.
 *
 * Sightings live in their own table (misinfo_monitoring_sightings), disjoint
 * from the skip logic, so merely *seeing* a post here never makes the regular
 * pipeline skip it later when it enters the small feed. Selection-LLM cost is
 * bounded to genuinely new keyword matches; processing is capped per run.
 */

import { fetchEligiblePosts, type Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import { buildPostSelection } from "../orchestration/utils/feedSizeStrategy";
import type { FeedSize } from "../ab-testing/botConfig";
import type { Candidate } from "../orchestration/submitCandidates";
import { processPosts, type ProcessPostItem, type TweetProcessedEvent } from "../orchestration/generateCandidates";
import { MISINFO_TOPICS } from "./topics";
import { matchPostsByTopic } from "./keywordFilter";
import { selectPostsNeedingNote } from "./selectPostsNeedingNote";
import { loadDumpFeed } from "./loadDumpFeed";

const MISINFO_MAX_RESULTS = 5000;
const MISINFO_MAX_PAGES = 100;
const MISINFO_FEED_SIZES: FeedSize[] = ["xxl", "xl", "large"];
// Cap selected posts processed per run so a heavy misinfo day can't starve the
// regular pipeline; the rest carry over via their needs_note=true sightings.
const MISINFO_MAX_PROCESS = 15;

export interface MisinfoCandidatesOptions {
  /** Shared with generateCandidates so already-noted / cooling-down tweets are
   *  not re-handled by the crawl. */
  skipPostIds: Set<string>;
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
  /** Local-testing only: read posts from this JSONL dump instead of crawling
   *  the live XXL feed (which is GH-Actions-only). See loadDumpFeed. */
  dumpPath?: string;
}

/** Try each feed size in turn; on any error fall through to the next. Returns
 *  null (fail-soft) if all sizes fail, so a feed blip never breaks the run. */
async function crawlFeed(
  skipPostIds: Set<string>,
): Promise<{ feedSize: FeedSize; posts: Post[] } | null> {
  for (const size of MISINFO_FEED_SIZES) {
    try {
      const posts = await fetchEligiblePosts(
        MISINFO_MAX_RESULTS,
        skipPostIds,
        MISINFO_MAX_PAGES,
        buildPostSelection(size),
      );
      console.log(`[misinfo] Crawled ${posts.length} posts from ${size} feed`);
      return { feedSize: size, posts };
    } catch (err) {
      console.warn(`[misinfo] Feed ${size} failed (${(err as Error)?.message}); trying next`);
    }
  }
  console.warn("[misinfo] All feed sizes failed; skipping pre-pass");
  return null;
}

/** Sight new keyword matches, run the selection LLM per topic, and write back
 *  each post's needs_note verdict. Bounds LLM cost to genuinely new matches. */
async function evaluateNewMatches(
  supabaseLogger: SupabaseLogger,
  feedSize: FeedSize,
  matched: Map<string, Post[]>,
): Promise<void> {
  const sightingKeys = await supabaseLogger.getMisinfoSightingKeys();

  for (const topic of MISINFO_TOPICS) {
    const topicPosts = matched.get(topic.id) ?? [];
    const newPosts = topicPosts.filter((p) => !sightingKeys.has(`${p.id}:${topic.id}`));
    if (!newPosts.length) continue;

    // Record sightings first (needs_note=null): a crash mid-evaluation leaves
    // them to be re-evaluated next run rather than lost.
    await supabaseLogger.upsertMisinfoSightings(
      newPosts.map((p) => ({
        tweet_id: p.id,
        topic_id: topic.id,
        feed_size: feedSize,
        impression_count: p.public_metrics?.impression_count,
        author_name: p.author_name,
      })),
    );

    const selected = await selectPostsNeedingNote(topic, newPosts);
    const reasonById = new Map(selected.map((s) => [s.postId, s.reason]));
    await supabaseLogger.recordMisinfoVerdicts(
      newPosts.map((p) => ({
        tweet_id: p.id,
        topic_id: topic.id,
        needs_note: reasonById.has(p.id),
        selection_reason: reasonById.get(p.id),
      })),
    );
    console.log(`[misinfo] ${topic.id}: ${newPosts.length} new matches, ${selected.length} need a note`);
  }
}

/**
 * Build the work list: posts that need a note and aren't processed yet, that we
 * have a Post object for in the current crawl. Deduped across topics (a post
 * matching two topics is processed once under its first-sighted topic — pending
 * rows come back id-ascending, i.e. first-sighted first) and capped.
 */
function buildWorkList(
  pending: Array<{ tweet_id: string; topic_id: string }>,
  postById: Map<string, Post>,
): Array<{ item: ProcessPostItem; topicId: string }> {
  const topicById = new Map(MISINFO_TOPICS.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const work: Array<{ item: ProcessPostItem; topicId: string }> = [];

  for (const s of pending) {
    if (seen.has(s.tweet_id)) continue;
    const post = postById.get(s.tweet_id);
    const topic = topicById.get(s.topic_id);
    if (!post || !topic) continue; // not in this crawl, or unknown topic
    seen.add(s.tweet_id);
    work.push({
      topicId: topic.id,
      item: {
        post,
        monitoring: {
          topicId: topic.id,
          topicTitle: topic.title,
          documentUrl: topic.documentUrl,
          document: topic.document,
        },
      },
    });
    if (work.length >= MISINFO_MAX_PROCESS) break;
  }
  return work;
}

export async function generateMisinfoCandidates(
  supabaseLogger: SupabaseLogger | null,
  { skipPostIds, onTweetProcessed, dumpPath }: MisinfoCandidatesOptions,
): Promise<Candidate[]> {
  // The sightings table is the dedupe ledger; without it we can't run the
  // pre-pass without re-evaluating the whole crawl every time.
  if (!supabaseLogger) {
    console.log("[misinfo] No Supabase logger; skipping misinfo pre-pass");
    return [];
  }

  let crawl: { feedSize: FeedSize; posts: Post[] } | null;
  if (dumpPath) {
    const posts = loadDumpFeed(dumpPath).filter((p) => !skipPostIds.has(p.id));
    console.log(`[misinfo] Loaded ${posts.length} posts from dump ${dumpPath} (live crawl bypassed)`);
    crawl = { feedSize: "xxl", posts };
  } else {
    crawl = await crawlFeed(skipPostIds);
  }
  if (!crawl) return [];
  const { feedSize, posts } = crawl;

  const matched = matchPostsByTopic(posts);
  await evaluateNewMatches(supabaseLogger, feedSize, matched);

  const pending = await supabaseLogger.getPendingMisinfoSightings();
  const postById = new Map(posts.map((p) => [p.id, p]));
  const work = buildWorkList(pending, postById);

  if (!work.length) {
    console.log("[misinfo] No posts to process this run");
    return [];
  }
  console.log(`[misinfo] Processing ${work.length} selected post(s)`);

  const topicByTweetId = new Map(work.map((w) => [w.item.post.id, w.topicId]));
  const onProcessed = async (event: TweetProcessedEvent) => {
    const topicId = topicByTweetId.get(event.post.id);
    if (topicId && event.tweetResult.pipelineRunId) {
      try {
        await supabaseLogger.markMisinfoProcessed(event.post.id, topicId, event.tweetResult.pipelineRunId);
      } catch (err) {
        console.warn("[misinfo] markMisinfoProcessed failed:", err);
      }
    }
    if (onTweetProcessed) await onTweetProcessed(event);
  };

  return processPosts(work.map((w) => w.item), supabaseLogger, {
    feedSize,
    onTweetProcessed: onProcessed,
    label: "misinfo",
  });
}
