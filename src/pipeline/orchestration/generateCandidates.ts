/**
 * Generate Candidates
 *
 * Walks the feed ladder for posts moving fast enough to be worth a note, runs
 * bot pipelines over them, scores them, and returns candidates that pass the
 * configured eval-score threshold.
 */

import { fetchEligiblePosts } from "../../api/fetchEligiblePosts";
import { SupabaseLogger } from "../../api/supabaseClient";
import { getBotById } from "../../bots/index";
import { processSingleTweet, type ProcessTweetResult } from "./processTweet";
import type { Candidate } from "./submitCandidates";
import { createTweetLog, withTweetLog, formatTweetLogSummary, formatTweetLogFull, formatRunSummary, getLoggedBotId, type TweetLogMap } from "../utils/tweetLog";
import { buildPostSelection, type FeedSize } from "./utils/feedSizeStrategy";
import { ageInHours, formatCount } from "./utils/tweetSorting";
import { runABTests, getBotProbabilities, getForcedPicks, withForcedPicks } from "../ab-testing/abTests";
import { AB_TESTS } from "../ab-testing/abTestsData";
import { withBotConfig } from "../ab-testing/botConfig";
import { withCostTracker } from "../cost-tracking/costTracker";
import { withWarnings } from "../utils/warnings";
import { withMonitoringContext, type MonitoringContext } from "../misinfo-monitoring/monitoringContext";
import { curateRegularFeedPosts, fillWithTopicPriority } from "../misinfo-monitoring/regularFeedTopicCuration";
import type { MisinfoTopic } from "../misinfo-monitoring/topics";
import type { MisinfoTopicId } from "../misinfo-monitoring/topicIds";
import {
  velocityPerHour,
  formatVelocity,
  isAboveVelocityFloor,
  REGULAR_VELOCITY_FLOOR_PER_HOUR,
  MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR,
} from "../utils/velocity";
import type { Post } from "../../api/fetchEligiblePosts";
import PQueue from "p-queue";

const CONCURRENCY_LIMIT = 5;
// Ceilings, not targets: walk each feed tier as deep as X will paginate. The
// real stop is next_token running out or a mid-walk rate limit
// (fetchEligiblePosts keeps what it already fetched) — the old 1000-post cap
// stopped every big tier at ~11 pages.
const FEED_MAX_POSTS = 50_000;
const FEED_MAX_PAGES = 500;
// Each tier is a superset of the one before it. Start at the curated small
// feed and broaden only when a tier fails or does not contain enough new posts
// to fill this run's budget — so small-feed posts get priority, and the
// lower-quality bulk of large/XL/XXL is only reached on demand.
const REGULAR_FEED_LADDER: FeedSize[] = ["small", "large", "xl", "xxl"];

/**
 * A post, the feed tier it was fetched from (logged, and recorded per-post in
 * `ab_test_picks.feed_size` so outcomes can be sliced by tier), and
 * its velocity FROZEN at fetch time. Freezing matters: velocity is impressions
 * over age, so re-deriving it after a pipeline run has elapsed would shrink it
 * (the impression count stays at its fetch-time value while age grows) and drop
 * posts we deliberately selected below the floor at submission.
 */
interface SourcedPost {
  post: Post;
  feedSize: FeedSize;
  velocity: number | null;
}

type FeedFetcher = (feedSize: FeedSize) => Promise<Post[]>;

/**
 * Walk the feed ladder one tier at a time: fetch, drop posts already seen,
 * compute velocity, keep only what clears the floor, and stop as soon as
 * `maxPosts` of them are pooled — otherwise broaden to the next tier. Filtering
 * here rather than at submission means a slow post never costs a pipeline run.
 * `selected` is the fastest first; unknown velocity fails open but sorts last.
 * `fresh` is EVERY new post the walked tiers surfaced, below-floor included —
 * topic curation matches against it (a curated-topic post answers to the lower
 * topic floor, not this one, so it must be discoverable here even when too
 * slow to be selected).
 *
 * Exported for deterministic tests of the broaden-until-full behavior.
 */
export async function collectFastPosts(
  maxPosts: number,
  knownTweetIds: Set<string>,
  fetchFeed: FeedFetcher,
  asOfMs: number = Date.now(),
): Promise<{ selected: SourcedPost[]; fresh: SourcedPost[] }> {
  const pool = new Map<string, SourcedPost>();
  const allFresh: SourcedPost[] = [];

  for (const feedSize of REGULAR_FEED_LADDER) {
    let posts: Post[];
    try {
      posts = await fetchFeed(feedSize);
    } catch (err) {
      console.warn(`[generate] Feed ${feedSize} failed (${(err as Error)?.message}); trying next tier`);
      continue;
    }

    const seenIds = new Set(allFresh.map((s) => s.post.id));
    const fresh = posts
      .filter((p) => !knownTweetIds.has(p.id) && !seenIds.has(p.id))
      .map((post) => ({ post, feedSize, velocity: velocityPerHour(post, asOfMs) }));
    allFresh.push(...fresh);
    const fastEnough = fresh.filter((s) => isAboveVelocityFloor(s.velocity));
    console.log(
      `[generate] Feed ${feedSize}: ${posts.length} posts, ${fresh.length} new, ` +
        `${fastEnough.length} above the ${formatVelocity(REGULAR_VELOCITY_FLOOR_PER_HOUR)} floor`,
    );
    for (const sourced of fastEnough) pool.set(sourced.post.id, sourced);
    if (pool.size >= maxPosts) break;
  }

  if (pool.size < maxPosts) {
    console.log(`[generate] Ladder exhausted: only ${pool.size} of ${maxPosts} post(s) clear the floor`);
  }

  const selected = [...pool.values()]
    .sort((a, b) => (b.velocity ?? -Infinity) - (a.velocity ?? -Infinity))
    .slice(0, maxPosts);
  return { selected, fresh: allFresh };
}

// ---------------------------------------------------------------------------
// Post fetching
// ---------------------------------------------------------------------------

async function fetchPosts(
  supabaseLogger: SupabaseLogger | null,
  maxPosts: number,
  prefetchedSkipPostIds?: Set<string>,
  prefetchedKnownTweetIds?: Set<string>,
): Promise<{ selected: SourcedPost[]; fresh: SourcedPost[] }> {
  let skipPostIds = prefetchedSkipPostIds;
  let knownTweetIds = prefetchedKnownTweetIds;

  // Fetch whatever the caller didn't pre-fetch. runPipeline pre-fetches both
  // (shared with the misinfo pre-pass) so notes/pipeline_runs aren't scanned
  // twice per run; other callers fetch here.
  if (supabaseLogger && (!skipPostIds || !knownTweetIds)) {
    try {
      const [skip, known] = await Promise.all([
        supabaseLogger.getSkipTweetIds(),
        supabaseLogger.getKnownTweetIds(),
      ]);
      skipPostIds = skipPostIds ?? skip;
      knownTweetIds = knownTweetIds ?? known;
    } catch (err) {
      console.warn("[generate] Failed to get known tweet IDs:", err);
    }
  }
  skipPostIds = skipPostIds ?? new Set<string>();
  knownTweetIds = knownTweetIds ?? new Set<string>();
  console.log(`[generate] Skip: ${skipPostIds.size} cooldown, ${knownTweetIds.size} already in tweets table`);

  // Insertion into the tweets table and the selection log happen in
  // generateCandidates AFTER topic curation, which can swap up to a few
  // posts — only what actually runs is recorded and logged.
  return collectFastPosts(
    maxPosts,
    knownTweetIds,
    (feedSize) => fetchEligiblePosts(FEED_MAX_POSTS, skipPostIds!, FEED_MAX_PAGES, buildPostSelection(feedSize)),
  );
}

/** Logged AFTER topic curation so it reflects the posts that actually run. */
function logSelection(selected: SourcedPost[], topicIdByTweet: Map<string, string>): void {
  const bySize: Partial<Record<FeedSize, number>> = {};
  for (const s of selected) bySize[s.feedSize] = (bySize[s.feedSize] ?? 0) + 1;
  console.log(`[generate] Processing ${selected.length} tweets: ${JSON.stringify(bySize)}`);
  for (const [i, s] of selected.entries()) {
    const imp = s.post.public_metrics?.impression_count ?? 0;
    const age = ageInHours(s.post);
    const topic = topicIdByTweet.get(s.post.id);
    console.log(`[generate]   #${i + 1}: ${s.post.id} | ${s.feedSize} | vel=${formatVelocity(s.velocity)} | ${formatCount(imp)} imp | ${age.toFixed(1)}h ago${topic ? ` | topic=${topic}` : ""}`);
  }
}

function logMediaBreakdown(posts: Post[]): void {
  const videoCount = posts.filter((p) => p.media?.some((m) => m.type === "video")).length;
  const photoCount = posts.filter(
    (p) => p.media?.some((m) => m.type === "photo") && !p.media?.some((m) => m.type === "video")
  ).length;
  const textOnlyCount = posts.filter((p) => !p.media || p.media.length === 0).length;
  console.log(
    `[generate] Media breakdown: ${videoCount} video, ${photoCount} photo-only, ${textOnlyCount} text-only`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface TweetProcessedEvent {
  post: Post;
  tweetResult: ProcessTweetResult;
  log: TweetLogMap;
  botId: string;
}

/**
 * A post to process, optionally with the misinfo-monitoring context that
 * injects a topic's reference document into the bot's research step. Regular
 * feed posts carry no monitoring context.
 */
export interface ProcessPostItem {
  post: Post;
  monitoring?: MonitoringContext;
  /** Velocity frozen when the post was fetched, carried onto the candidate so
   *  the submission-time floor doesn't re-derive a decayed value. Omitted by
   *  callers that select posts some other way (the pre-passes). */
  velocity?: number | null;
  /** Feed tier this post was fetched from, recorded as its feed_size pick.
   *  Omitted callers resolve to the default `small`. */
  feedSize?: FeedSize;
}

export interface ProcessPostsOptions {
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
  /** Log prefix so the misinfo pre-pass and regular pass are distinguishable. */
  label?: string;
}

/**
 * Run the per-post pipeline over `items` concurrently: AB-pick a bot, wrap it
 * in the per-tweet ALS contexts (forced picks, monitoring, tweet log, bot
 * config, cost tracker), process, score, and collect candidates. Shared by the
 * regular feed pass and the XXL-feed misinfo pre-pass.
 */
export async function processPosts(
  items: ProcessPostItem[],
  supabaseLogger: SupabaseLogger | null,
  { onTweetProcessed, label = "generate" }: ProcessPostsOptions,
): Promise<Candidate[]> {
  if (!items.length) return [];

  const commit = process.env.GITHUB_SHA;
  const outerForcedPicks = getForcedPicks();

  const queue = new PQueue({ concurrency: CONCURRENCY_LIMIT });
  const allLogs: TweetLogMap[] = [];
  const candidates: Candidate[] = [];

  for (const [idx, item] of items.entries()) {
    // Misinfo pre-pass posts carry a MonitoringContext — record that they came
    // from monitoring and which topic; regular posts sample the default no/none.
    const monitoringPicks: Record<string, string> = item.monitoring
      ? { misinfo_monitoring: "yes", misinfo_topic: item.monitoring.topicId }
      : {};
    // The feed tier isn't sampled — it's decided at fetch time — so force
    // feed_size to the tier THIS post actually came from.
    const feedSizePick: Record<string, string> = item.feedSize ? { feed_size: item.feedSize } : {};
    const perPostPicks = { ...outerForcedPicks, ...feedSizePick, ...monitoringPicks };
    queue.add(() => withForcedPicks(perPostPicks, () => withMonitoringContext(item.monitoring, async () => {
      // Forced picks (if any) are already in ALS — set up by runPipeline.ts
      // via withForcedPicks. runABTests honours them for whichever tests fire.
      const { config, picks } = runABTests(AB_TESTS);
      const selectedBot = getBotById(config.botId);
      if (!selectedBot) {
        throw new Error(`No bot registered for id "${config.botId}" picked by AB_TESTS`);
      }

      const log = createTweetLog();
      log.set("tweet.index", idx + 1);
      log.set("tweet.total", items.length);

      const tweetResult = await withTweetLog(log, () =>
        withWarnings(() =>
          withBotConfig(config, () =>
            withCostTracker(() => {
              log.set("bot.id", config.botId);
              log.set("bot.picks", picks);
              log.set("bot.config", config);
              return processSingleTweet({
                post: item.post,
                bot: selectedBot,
                logger: supabaseLogger,
                commitSha: commit,
              });
            }),
          ),
        ),
      );

      console.log(`${formatTweetLogSummary(log)}\n${formatTweetLogFull(log)}`);
      allLogs.push(log);

      const botId = getLoggedBotId(selectedBot.id, log);
      if (onTweetProcessed) {
        try { await onTweetProcessed({ post: item.post, tweetResult, log, botId }); }
        catch (err) { console.warn(`[${label}] onTweetProcessed hook failed:`, err); }
      }

      if (tweetResult.outcome === "candidate" && tweetResult.pipelineRunId) {
        candidates.push({ post: item.post, tweetResult, botId, velocity: item.velocity });
      }
    })));
  }

  await queue.onIdle();

  if (process.env.CI) {
    console.log("::endgroup::");
    console.log("::group::Run summary");
  }
  console.log(`[${label}] ${candidates.length} candidates, ${items.length - candidates.length} rejected (of ${items.length} processed)`);
  console.log(formatRunSummary(allLogs));
  if (process.env.CI) console.log("::endgroup::");

  return candidates;
}

export interface GenerateCandidatesOptions {
  maxPosts: number;
  /** Pre-fetched by runPipeline and shared with the misinfo pre-pass to avoid
   *  double-scanning notes/pipeline_runs/tweets. Omitted callers fetch them. */
  skipPostIds?: Set<string>;
  knownTweetIds?: Set<string>;
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
  /** Curated topics to match against the regular pool: confirmed posts get the
   *  full monitoring treatment, answer to the topic velocity floor instead of
   *  the regular one, and take a bounded share of maxPosts (see
   *  regularFeedTopicCuration.ts). Empty/omitted disables curation entirely. */
  topicIds?: readonly MisinfoTopicId[];
}

export async function generateCandidates(
  supabaseLogger: SupabaseLogger | null,
  { maxPosts, skipPostIds, knownTweetIds, onTweetProcessed, topicIds }: GenerateCandidatesOptions,
): Promise<Candidate[]> {
  const outerForcedPicks = getForcedPicks();
  if (Object.keys(outerForcedPicks).length > 0) {
    console.log(`[generate] Forced picks: ${JSON.stringify(outerForcedPicks)}`);
  }
  const botProbs = getBotProbabilities();
  const activeBots = botProbs.filter((b) => b.probability > 0);
  console.log(`[generate] Bots: ${activeBots.map((b) => `${b.id} ${b.probability.toFixed(1)}%`).join(", ")}`);

  const { selected, fresh } = await fetchPosts(supabaseLogger, maxPosts, skipPostIds, knownTweetIds);

  // Curated-topic matching over the whole fresh pool — below-REGULAR-floor
  // posts included, because confirmed topic posts answer to the lower topic
  // floor (applied in fillWithTopicPriority), not the regular 30k one. A
  // 4k–30k topic post is exactly the case the wider pool exists for.
  // Fail-soft: curation (incl. the selection LLM, which throws on
  // unrecoverable output by design) must never take down the regular pass —
  // unjudged sightings are simply re-evaluated next run.
  let confirmedTopics = new Map<string, MisinfoTopic>();
  if (topicIds?.length && supabaseLogger) {
    try {
      confirmedTopics = await curateRegularFeedPosts({ fresh, supabaseLogger, topicIds });
    } catch (err) {
      console.warn("[generate] topic curation failed; continuing without it:", err);
    }
  }
  const { final, prioritized, displacedCount, floorDropped } = fillWithTopicPriority(
    selected,
    new Set(confirmedTopics.keys()),
    fresh,
    maxPosts,
  );
  if (floorDropped.length) {
    console.log(
      `[generate] topic curation: velocity floor: dropped ${floorDropped.length} confirmed post(s) below ` +
        `${formatVelocity(MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR)} — ` +
        floorDropped.map((s) => `${s.post.id} vel=${formatVelocity(s.velocity)}`).join(", "),
    );
  }
  if (prioritized.length) {
    console.log(
      `[generate] topic curation: +${prioritized.length} prioritized (${displacedCount} regular post(s) displaced) — ` +
        prioritized.map((s) => `${s.post.id} vel=${formatVelocity(s.velocity)}`).join(", "),
    );
  }
  if (!final.length) {
    console.log("[generate] No eligible posts found.");
    return [];
  }

  // Only the posts we're about to process are recorded. The tweets table is the
  // "already handled, don't fetch again" ledger, so recording everything the
  // ladder walked past would burn every below-floor post on first sight — and a
  // post that is slow now may be worth a note once it takes off. (The full feed
  // pull is archived separately, in feed_tweets.) Runs after curation so a
  // displaced regular post is NOT burned and a prioritized topic post IS.
  if (supabaseLogger && final.length) {
    try {
      await supabaseLogger.bulkInsertNewTweets(final.map((s) => s.post));
      console.log(`[generate] Inserted ${final.length} new tweets`);
    } catch (err) {
      console.warn("[generate] Failed to bulk-insert tweets:", err);
    }
  }

  const topicIdByTweet = new Map(
    [...confirmedTopics].map(([tweetId, topic]) => [tweetId, topic.id]),
  );
  logSelection(final, topicIdByTweet);
  logMediaBreakdown(final.map((s) => s.post));

  // Confirmed posts get the same MonitoringContext as pre-pass topic posts:
  // reference-document injection, advisory eval gate, prefilter bypass, and
  // the misinfo_topic pick (all keyed off item.monitoring downstream).
  const items: ProcessPostItem[] = final.map((s) => {
    const topic = confirmedTopics.get(s.post.id);
    return {
      post: s.post,
      velocity: s.velocity,
      feedSize: s.feedSize,
      monitoring: topic
        ? { topicId: topic.id, topicTitle: topic.title, documentUrl: topic.documentUrl, document: topic.document }
        : undefined,
    };
  });

  // Stamp curated posts' sightings as processed (same bookkeeping as the
  // pre-pass — drives attribution and the misinfo submit-reserve accounting).
  const curatedInRun = new Set(items.filter((i) => i.monitoring).map((i) => i.post.id));
  const onProcessed = curatedInRun.size
    ? async (event: TweetProcessedEvent) => {
        const topicId = topicIdByTweet.get(event.post.id);
        if (topicId && curatedInRun.has(event.post.id) && event.tweetResult.pipelineRunId && supabaseLogger) {
          try {
            await supabaseLogger.markMisinfoProcessed(event.post.id, topicId, event.tweetResult.pipelineRunId);
          } catch (err) {
            console.warn("[generate] markMisinfoProcessed failed:", err);
          }
        }
        if (onTweetProcessed) await onTweetProcessed(event);
      }
    : onTweetProcessed;

  const candidates = await processPosts(items, supabaseLogger, {
    onTweetProcessed: onProcessed,
    label: "generate",
  });
  // Tag curated candidates like pre-pass ones so submitCandidates applies the
  // misinfo semantics (velocity-floor backstop exemption + bounded priority
  // reserve). Done HERE, not in shared processPosts: other processPosts
  // callers (e.g. the pangram pre-pass) must not silently inherit these.
  return candidates.map((c) => (curatedInRun.has(c.post.id) ? { ...c, isMisinfo: true } : c));
}
