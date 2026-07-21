/**
 * Generate Candidates
 *
 * Fetches new tweets from the feed, runs bot pipelines, scores them,
 * and returns candidates that pass the configured eval-score threshold.
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
import { velocityPerHour, formatVelocity } from "../utils/velocity";
import type { Post } from "../../api/fetchEligiblePosts";
import PQueue from "p-queue";

const CONCURRENCY_LIMIT = 5;
const BACKLOG_LIMIT = 1000;
// The large feed contains the small feed, so fetching small first only gives
// its posts an artificial priority. Start at large; broaden to XL/XXL only when
// needed, then fall back to small for accounts without broader-feed access.
const REGULAR_FEED_LADDER: FeedSize[] = ["large", "xl", "xxl", "small"];

/** A post plus the feed tier it was fetched from (kept for operational logs). */
interface SourcedPost {
  post: Post;
  feedSize: FeedSize;
}

type FeedFetcher = (feedSize: FeedSize) => Promise<Post[]>;

/**
 * Fetch the preferred feed tiers in order, dedupe their overlapping contents,
 * and pick the globally fastest posts. Unknown velocity sorts last.
 */
async function collectVelocityRankedPosts(
  maxPosts: number,
  knownTweetIds: Set<string>,
  fetchFeed: FeedFetcher,
  asOfMs: number = Date.now(),
): Promise<{ selected: SourcedPost[]; allNew: SourcedPost[] }> {
  const pool = new Map<string, SourcedPost>();

  for (const feedSize of REGULAR_FEED_LADDER) {
    let posts: Post[];
    try {
      posts = await fetchFeed(feedSize);
    } catch (err) {
      console.warn(`[generate] Feed ${feedSize} failed (${(err as Error)?.message}); trying next tier`);
      continue;
    }

    const newPosts = posts.filter((p) => !knownTweetIds.has(p.id) && !pool.has(p.id));
    console.log(`[generate] Feed ${feedSize}: ${posts.length} posts, ${newPosts.length} new`);
    for (const post of newPosts) pool.set(post.id, { post, feedSize });
    if (pool.size >= maxPosts) break;
  }

  const selected = [...pool.values()]
    .sort((a, b) =>
      (velocityPerHour(b.post, asOfMs) ?? -Infinity)
      - (velocityPerHour(a.post, asOfMs) ?? -Infinity),
    )
    .slice(0, maxPosts);
  return { selected, allNew: [...pool.values()] };
}

// ---------------------------------------------------------------------------
// Post fetching
// ---------------------------------------------------------------------------

async function fetchPosts(
  supabaseLogger: SupabaseLogger | null,
  maxPosts: number,
  prefetchedSkipPostIds?: Set<string>,
  prefetchedKnownTweetIds?: Set<string>,
): Promise<{ posts: SourcedPost[]; allNew: SourcedPost[] }> {
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

  const { selected, allNew } = await collectVelocityRankedPosts(
    maxPosts,
    knownTweetIds,
    (feedSize) => fetchEligiblePosts(BACKLOG_LIMIT, skipPostIds!, 50, buildPostSelection(feedSize)),
  );

  if (supabaseLogger && allNew.length) {
    try {
      await supabaseLogger.bulkInsertNewTweets(allNew.map(({ post }) => post));
      console.log(`[generate] Inserted ${allNew.length} new tweets`);
    } catch (err) {
      console.warn("[generate] Failed to bulk-insert tweets:", err);
    }
  }

  return { posts: selected, allNew };
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
    console.log(`[generate]   #${i + 1}: ${s.post.id} | ${s.feedSize} | vel=${formatVelocity(velocityPerHour(s.post))} | ${formatCount(imp)} imp | ${age.toFixed(1)}h ago${topic ? ` | topic=${topic}` : ""}`);
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
    const perPostPicks = { ...outerForcedPicks, ...monitoringPicks };
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
        candidates.push({ post: item.post, tweetResult, botId });
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
   *  full monitoring treatment and a bounded share of maxPosts (see
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

  const { posts, allNew } = await fetchPosts(supabaseLogger, maxPosts, skipPostIds, knownTweetIds);
  if (!posts.length) {
    console.log("[generate] No eligible posts found.");
    return [];
  }

  // Curated-topic matching over the whole new-post pool. Fail-soft: curation
  // (incl. the selection LLM, which throws on unrecoverable output by design)
  // must never take down the regular pass — unjudged sightings are simply
  // re-evaluated next run.
  let confirmedTopics = new Map<string, MisinfoTopic>();
  if (topicIds?.length && supabaseLogger) {
    try {
      confirmedTopics = await curateRegularFeedPosts({ allNew, supabaseLogger, topicIds });
    } catch (err) {
      console.warn("[generate] topic curation failed; continuing without it:", err);
    }
  }
  const { final, prioritized, displacedCount } = fillWithTopicPriority(
    posts,
    new Set(confirmedTopics.keys()),
    allNew,
    maxPosts,
  );
  if (prioritized.length) {
    console.log(
      `[generate] topic curation: +${prioritized.length} prioritized (${displacedCount} regular post(s) displaced) — ` +
        prioritized.map((s) => `${s.post.id} vel=${formatVelocity(velocityPerHour(s.post))}`).join(", "),
    );
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
  // misinfo semantics (velocity-floor exemption + bounded priority reserve).
  // Done HERE, not in shared processPosts: other processPosts callers (e.g.
  // the pangram pre-pass) must not silently inherit these semantics.
  return candidates.map((c) => (curatedInRun.has(c.post.id) ? { ...c, isMisinfo: true } : c));
}
