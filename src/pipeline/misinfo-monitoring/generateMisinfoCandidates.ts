/**
 * XXL-feed misinfo-monitoring pre-pass.
 *
 * This runs before the regular pipeline. It crawls the big feed, trying the XXL
 * size first and falling back to XL and then to large. It keyword-matches the
 * crawled posts against the fixed misinfo topics. A selection LLM then judges which
 * of the matched posts really carry a misleading claim, and those posts are
 * processed first. The topic's ground-truth article is injected into the bot's
 * research step through MonitoringContext, so the resulting note is well sourced.
 *
 * Sightings live in their own table, misinfo_monitoring_sightings, which the skip
 * logic never reads. Seeing a post here therefore never makes the regular pipeline
 * skip it later, when the same post enters the small feed. The selection LLM only
 * ever judges keyword matches it has not seen before, which bounds its cost. The
 * number of posts processed per run is capped.
 *
 * A run only processes the posts it selected in that same run. There is no
 * carry-over queue. The sightings ledger records that a post has already been
 * judged, and it is not a backlog. A selected post that does not fit under the
 * per-run cap is dropped rather than saved for later.
 */

import { fetchEligiblePosts, type Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import { buildPostSelection, type FeedSize } from "../orchestration/utils/feedSizeStrategy";
import type { Candidate } from "../orchestration/submitCandidates";
import { processPosts, type ProcessPostItem, type TweetProcessedEvent } from "../orchestration/generateCandidates";
import { MISINFO_TOPICS, type MisinfoTopic } from "./topics";
import type { MisinfoTopicId } from "./topicIds";
import { matchPostsByTopic } from "./keywordFilter";
import { selectPostsNeedingNote } from "./selectPostsNeedingNote";
import { loadDumpFeed } from "./loadDumpFeed";
import {
  velocityPerHour,
  formatVelocity,
  isAboveFloor,
  MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR,
} from "../utils/velocity";

const MISINFO_MAX_RESULTS = 5000;
const MISINFO_MAX_PAGES = 100;
const MISINFO_FEED_SIZES: FeedSize[] = ["xxl", "xl", "large"];
// The most misinfo posts we process in one run, and therefore the most notes this
// pre-pass can write and submit. The ceiling stops a heavy misinfo day from starving
// the regular pipeline or eating the shared daily submission cap. Selected posts
// beyond the ceiling are dropped rather than queued for later. The posts with the
// highest velocity are the ones kept.
const MISINFO_MAX_PROCESS = 10;

// The topic velocity floor is the shared MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR, and
// utils/velocity.ts explains why it exists. We apply it before the cap above. A
// selected post below the floor is dropped and logged rather than queued, which is
// the same treatment a post dropped by the cap gets. Its sighting verdict is already
// recorded, so the selection LLM never judges it again. The regular-pool curation
// route applies the same floor in fillWithTopicPriority. A post dropped here for
// being too slow must not come back in through the stored-verdict rescue there.

export interface MisinfoCandidatesOptions {
  /** Post ids the crawl must leave alone. This set is shared with generateCandidates,
   *  so a tweet we have already noted, or one that is cooling down, is not handled
   *  twice. */
  skipPostIds: Set<string>;
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
  /** For local testing only. When this is set we read posts from the given JSONL dump
   *  instead of crawling the live XXL feed, which is only reachable from GitHub
   *  Actions. See loadDumpFeed. */
  dumpPath?: string;
  /** Restricts the pre-pass to these topics. Omit it to run every topic in
   *  MISINFO_TOPICS. This lets us activate a single campaign, such as
   *  trump_election_security, without also running the evergreen topics. */
  topicIds?: MisinfoTopicId[];
}

/** Tries each feed size in turn, and falls through to the next one on any error.
 *  Returns null when every size fails, so a passing feed problem never breaks the
 *  whole run. */
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

/** Records the keyword matches we have not seen before, runs the selection LLM once
 *  per topic, writes back each post's needs_note verdict, and returns the posts
 *  chosen for a note. Only genuinely new matches reach the LLM, so a post is judged
 *  once and never again. */
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

    // Record the sightings first, with needs_note left null. getMisinfoSightingKeys
    // ignores rows whose needs_note is still null, so a crash part-way through the
    // evaluation leaves these posts to be judged again on the next run.
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
 * Builds the work list from the posts this run selected. A post that matched two
 * topics is processed once, under the first topic it matched. The surviving posts
 * are then filtered by the velocity floor described above and sorted by velocity,
 * which is impressions per hour. That way the cap keeps the posts whose notes stand
 * a real chance of being rated.
 */
function buildWorkList(
  selectedNew: Array<{ post: Post; topic: MisinfoTopic }>,
  feedSize: FeedSize,
): Array<{ item: ProcessPostItem; topicId: string }> {
  const seen = new Set<string>();
  const deduped = selectedNew.filter(({ post }) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });

  // A post whose velocity we cannot work out counts as being above the floor. We
  // never drop a post just because its data is missing.
  const floored = deduped.filter(({ post }) =>
    isAboveFloor(velocityPerHour(post), MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR),
  );
  if (floored.length < deduped.length) {
    const dropped = deduped.filter((w) => !floored.includes(w));
    console.log(
      `[misinfo] velocity floor: dropped ${dropped.length} of ${deduped.length} selected post(s) below ` +
        `${formatVelocity(MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR)} — ` +
        dropped.map(({ post }) => `${post.id} vel=${formatVelocity(velocityPerHour(post))}`).join(", "),
    );
  }

  const capped = floored
    .sort((a, b) => (velocityPerHour(b.post) ?? -Infinity) - (velocityPerHour(a.post) ?? -Infinity))
    .slice(0, MISINFO_MAX_PROCESS);
  if (floored.length > capped.length) {
    console.log(`[misinfo] Cap: processing ${capped.length} of ${floored.length} selected posts (rest dropped, not queued)`);
  }

  const work = capped.map(({ post, topic }) => ({
    topicId: topic.id,
    item: {
      post,
      feedSize,
      monitoring: {
        topicId: topic.id,
        topicTitle: topic.title,
        documentUrl: topic.documentUrl,
        document: topic.document,
      },
    },
  }));
  // Posts on the same topic run one after another. The injected reference document
  // then forms the same prompt prefix on consecutive calls, which is what the
  // provider's prefix cache needs in order to hit.
  return work.sort((a, b) => a.topicId.localeCompare(b.topicId));
}

export async function generateMisinfoCandidates(
  supabaseLogger: SupabaseLogger | null,
  { skipPostIds, onTweetProcessed, dumpPath, topicIds }: MisinfoCandidatesOptions,
): Promise<Candidate[]> {
  // The sightings table is the ledger that stops us judging the same post twice.
  // Without it every run would re-evaluate the whole crawl.
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
  const work = buildWorkList(selectedNew, feedSize);

  if (!work.length) {
    console.log("[misinfo] No posts to process this run");
    return [];
  }
  console.log(`[misinfo] Processing ${work.length} selected post(s)`);

  // Store the tweets we are about to note, so the review dashboard and any other
  // view that joins on tweets has their content. generateCandidates and the pangram
  // pre-pass both do this. The misinfo pre-pass used to skip it, which made misinfo
  // notes show blank tweet cards. A failure here is only logged, because it must not
  // stop us writing notes.
  try {
    await supabaseLogger.bulkInsertNewTweets(work.map((w) => w.item.post));
  } catch (err) {
    console.warn("[misinfo] bulkInsertNewTweets failed:", err);
  }

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

  const candidates = await processPosts(work.map((w) => w.item), supabaseLogger, {
    onTweetProcessed: onProcessed,
    label: "misinfo",
  });
  // Tag these as misinfo so submitCandidates exempts them from its own velocity-floor
  // backstop. This pre-pass has already applied the lower topic floor to them. They
  // are also handed back to runPipeline ahead of the regular candidates, so they
  // submit first.
  return candidates.map((c) => ({ ...c, isMisinfo: true }));
}
