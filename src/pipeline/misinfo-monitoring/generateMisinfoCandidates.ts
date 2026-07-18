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
 *
 * Each run processes only posts newly selected in that run — there is no
 * carry-over queue. The sightings ledger is a dedupe record ("already judged"),
 * not a backlog: a selected post that misses the per-run cap is dropped, not
 * saved for later.
 */

import { fetchEligiblePosts, type Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import { buildPostSelection } from "../orchestration/utils/feedSizeStrategy";
import type { FeedSize } from "../ab-testing/botConfig";
import type { Candidate } from "../orchestration/submitCandidates";
import { processPosts, type ProcessPostItem, type TweetProcessedEvent } from "../orchestration/generateCandidates";
import { MISINFO_TOPICS, type MisinfoTopic } from "./topics";
import type { MisinfoTopicId } from "./topicIds";
import { matchPostsByTopic } from "./keywordFilter";
import { selectPostsNeedingNote } from "./selectPostsNeedingNote";
import { loadDumpFeed } from "./loadDumpFeed";

const MISINFO_MAX_RESULTS = 5000;
const MISINFO_MAX_PAGES = 100;
const MISINFO_FEED_SIZES: FeedSize[] = ["xxl", "xl", "large"];
// Ceiling on misinfo posts processed (and thus notes written/submitted) per run,
// so a heavy misinfo day can't starve the regular pipeline or eat the shared
// daily submission cap. Selected posts beyond it are dropped (highest-impression
// posts win the cap), not queued for later.
const MISINFO_MAX_PROCESS = 10;

export interface MisinfoCandidatesOptions {
  /** Shared with generateCandidates so already-noted / cooling-down tweets are
   *  not re-handled by the crawl. */
  skipPostIds: Set<string>;
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
  /** Local-testing only: read posts from this JSONL dump instead of crawling
   *  the live XXL feed (which is GH-Actions-only). See loadDumpFeed. */
  dumpPath?: string;
  /** Restrict the pre-pass to these topics only; omit for all MISINFO_TOPICS.
   *  Lets us activate a single campaign (e.g. trump_election_security) without
   *  running the evergreen topics. */
  topicIds?: MisinfoTopicId[];
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

/** Sight new keyword matches, run the selection LLM per topic, write back each
 *  post's needs_note verdict, and return the posts selected for a note. Bounds
 *  LLM cost to genuinely new matches: a post is judged once, ever. */
async function evaluateNewMatches(
  supabaseLogger: SupabaseLogger,
  feedSize: FeedSize,
  matched: Map<string, Post[]>,
  topics: MisinfoTopic[],
): Promise<Array<{ post: Post; topic: MisinfoTopic }>> {
  const sightingKeys = await supabaseLogger.getMisinfoSightingKeys();
  const selectedWork: Array<{ post: Post; topic: MisinfoTopic }> = [];

  for (const topic of topics) {
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

    for (const p of newPosts) {
      if (reasonById.has(p.id)) selectedWork.push({ post: p, topic });
    }
  }
  return selectedWork;
}

/**
 * Build the work list from this run's freshly-selected posts. Deduped across
 * topics (a post matching two topics is processed once under its first topic),
 * highest-impression first so the cap keeps the highest-impact posts.
 */
function buildWorkList(
  selectedNew: Array<{ post: Post; topic: MisinfoTopic }>,
): Array<{ item: ProcessPostItem; topicId: string }> {
  const seen = new Set<string>();
  const deduped = selectedNew.filter(({ post }) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });

  const capped = deduped
    .sort((a, b) => (b.post.public_metrics?.impression_count ?? 0) - (a.post.public_metrics?.impression_count ?? 0))
    .slice(0, MISINFO_MAX_PROCESS);
  if (deduped.length > capped.length) {
    console.log(`[misinfo] Cap: processing ${capped.length} of ${deduped.length} selected posts (rest dropped, not queued)`);
  }

  const work = capped.map(({ post, topic }) => ({
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
  }));
  // Run same-topic posts consecutively so the injected reference document forms
  // a stable prompt prefix across calls, maximizing provider prefix-cache hits.
  return work.sort((a, b) => a.topicId.localeCompare(b.topicId));
}

export async function generateMisinfoCandidates(
  supabaseLogger: SupabaseLogger | null,
  { skipPostIds, onTweetProcessed, dumpPath, topicIds }: MisinfoCandidatesOptions,
): Promise<Candidate[]> {
  // The sightings table is the dedupe ledger; without it we can't run the
  // pre-pass without re-evaluating the whole crawl every time.
  if (!supabaseLogger) {
    console.log("[misinfo] No Supabase logger; skipping misinfo pre-pass");
    return [];
  }

  const topics = topicIds
    ? MISINFO_TOPICS.filter((t) => topicIds.includes(t.id))
    : MISINFO_TOPICS;
  if (!topics.length) {
    console.log(`[misinfo] No matching topics for ${JSON.stringify(topicIds)}; skipping pre-pass`);
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
  const selectedNew = await evaluateNewMatches(supabaseLogger, feedSize, matched, topics);
  const work = buildWorkList(selectedNew);

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
