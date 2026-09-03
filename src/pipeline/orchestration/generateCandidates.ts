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
import { featuresFromPost } from "../ranking/features";
import { shadowScores, type Scorer } from "../ranking/scorers";
import type { Post } from "../../api/fetchEligiblePosts";
import PQueue from "p-queue";

// Ten posts process at once. Five was the long-standing setting, and it left
// the engine's daily output (~50 notes) below the cap X grants us (~65 and
// rising as ratings recover) — the batch was clock-limited, not work-limited.
// Doubling the overlap fits a full batch back inside the soft deadline. The
// shared search queue still paces every search 4 seconds apart across ALL
// posts, so search-heavy stages serialize regardless; what parallelizes is
// the LLM-latency waiting, which dominates. Going higher than this buys
// little more (the batch is at most 20 and the runner has 2 cores for the
// media steps) and risks rate-limit bursts — step, measure a day of logs,
// then step again if clean.
const CONCURRENCY_LIMIT = 10;
// These two are ceilings, not targets. Each feed tier is walked as deep as X
// will paginate. What actually stops a walk is next_token running out, or a rate
// limit part-way through, in which case fetchEligiblePosts keeps whatever it
// already fetched. The old cap of 1000 posts stopped every big tier at about 11
// pages.
const FEED_MAX_POSTS = 50_000;
const FEED_MAX_PAGES = 500;
// Each tier is a superset of the one before it. The walk starts at the curated
// small feed. It broadens only when a tier fails, or when a tier does not hold
// enough new posts to fill this run's budget. Small-feed posts therefore get
// priority, and the lower-quality bulk of the large and XL feeds is reached only
// when it is needed.
export const REGULAR_FEED_LADDER: FeedSize[] = ["small", "large", "xl"];

/**
 * A post together with the feed tier it was fetched from and its velocity. The
 * tier is logged, and it is also recorded for each post in
 * `ab_test_picks.feed_size`, so outcomes can be sliced by tier. The velocity is
 * frozen at fetch time. Freezing matters because velocity is impressions divided
 * by age. Deriving it again after a pipeline run has taken time would shrink it,
 * because the impression count stays at its fetch-time value while the age keeps
 * growing. Posts we deliberately selected would then fall below the floor at
 * submission and be dropped.
 */
export interface SourcedPost {
  post: Post;
  feedSize: FeedSize;
  velocity: number | null;
}

type FeedFetcher = (feedSize: FeedSize) => Promise<Post[]>;

/**
 * Walk the feed ladder one tier at a time. For each tier this fetches the posts,
 * drops the ones already seen, computes each post's velocity, and keeps only the
 * posts that clear the floor. It stops as soon as `maxPosts` of them are pooled,
 * and otherwise broadens to the next tier. Filtering here rather than at
 * submission means a slow post never costs a pipeline run.
 *
 * `selected` is ordered by feed tier first, so every above-floor small post
 * comes before any large one, and every large one before any XL one. Within a
 * tier it is ordered by velocity. A curated small post is therefore never bumped
 * by a faster post from a broader tier. A post whose velocity is unknown is
 * kept, because the floor fails open, and it sorts last within its tier.
 *
 * `fresh` is every new post the walked tiers surfaced, including the ones below
 * the floor. Topic curation matches against that list. A curated topic post
 * answers to the lower topic floor rather than this one, so it has to be
 * discoverable here even when it is too slow to be selected.
 *
 * This function is exported so that the broaden-until-full behaviour can be
 * tested deterministically.
 */
export async function collectFastPosts(
  maxPosts: number,
  knownTweetIds: Set<string>,
  fetchFeed: FeedFetcher,
  asOfMs: number = Date.now(),
  scorer: Scorer | null = null,
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
    // A scorer ranks across tiers, so it needs to see every tier before choosing.
    if (!scorer && pool.size >= maxPosts) break;
  }

  if (pool.size < maxPosts) {
    console.log(`[generate] Ladder exhausted: only ${pool.size} of ${maxPosts} post(s) clear the floor`);
  }

  const tierRank = (feedSize: FeedSize) => REGULAR_FEED_LADDER.indexOf(feedSize);
  const byTierThenVelocity = (a: SourcedPost, b: SourcedPost) =>
    tierRank(a.feedSize) - tierRank(b.feedSize) || (b.velocity ?? -Infinity) - (a.velocity ?? -Infinity);
  const byScorer = (a: SourcedPost, b: SourcedPost) =>
    scorer!.scoreAdmission(featuresFromPost(b.post, b.velocity, tierRank(b.feedSize), asOfMs)) -
    scorer!.scoreAdmission(featuresFromPost(a.post, a.velocity, tierRank(a.feedSize), asOfMs));
  const selected = [...pool.values()].sort(scorer ? byScorer : byTierThenVelocity).slice(0, maxPosts);
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
  scorer: Scorer | null = null,
): Promise<{ selected: SourcedPost[]; fresh: SourcedPost[] }> {
  let skipPostIds = prefetchedSkipPostIds;
  let knownTweetIds = prefetchedKnownTweetIds;

  // Fetch whatever the caller did not pre-fetch. runPipeline pre-fetches both
  // sets and shares them with the misinfo pre-pass, so the notes and
  // pipeline_runs tables are not scanned twice in one run. Other callers let
  // this branch do the fetching.
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

  // The insert into the tweets table and the selection log both happen in
  // generateCandidates, after topic curation. Curation can swap out a few posts,
  // so waiting until then means only the posts that actually run are recorded
  // and logged.
  return collectFastPosts(
    maxPosts,
    knownTweetIds,
    (feedSize) => fetchEligiblePosts(FEED_MAX_POSTS, skipPostIds!, FEED_MAX_PAGES, buildPostSelection(feedSize)),
    Date.now(),
    scorer,
  );
}

/** This is logged after topic curation, so it reflects the posts that actually
 *  run. */
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
  /** The velocity frozen when the post was fetched. It is carried onto the
   *  candidate so that the floor check at submission time does not derive a
   *  decayed value of its own. Callers that select posts some other way, such as
   *  the pre-passes, leave it out. */
  velocity?: number | null;
  /** The feed tier this post was fetched from, recorded as its feed_size pick.
   *  When a caller leaves it out, the pick falls back to the A/B test default,
   *  which is `small`. */
  feedSize?: FeedSize;
}

export interface ProcessPostsOptions {
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
  /** A prefix for the log lines, so that the misinfo pre-pass and the regular
   *  pass can be told apart in the output. */
  label?: string;
  /** The soft deadline as an epoch timestamp. A post whose processing has not
   *  started by this moment is skipped instead of started, so the run always
   *  has time left to submit the notes it finished. The posts are processed in
   *  selection order, which is value order, so what the deadline cuts is the
   *  least valuable tail of the batch. A skipped post's retry semantics match
   *  what the hard kill already did to never-started posts: its tweets row was
   *  written at selection, so it is not refetched. Unset means no deadline. */
  deadlineMs?: number;
}

/**
 * Run the per-post pipeline over `items` concurrently. For each post this picks
 * a bot through the A/B tests, wraps the run in the per-tweet async-local
 * contexts, processes the post, scores it, and collects the candidates. Those
 * contexts are the forced picks, the monitoring context, the tweet log, the bot
 * config, and the cost tracker. The regular feed pass and the XXL-feed misinfo
 * pre-pass both use this function.
 */
export async function processPosts(
  items: ProcessPostItem[],
  supabaseLogger: SupabaseLogger | null,
  { onTweetProcessed, label = "generate", deadlineMs }: ProcessPostsOptions,
): Promise<Candidate[]> {
  if (!items.length) return [];

  const commit = process.env.GITHUB_SHA;
  const outerForcedPicks = getForcedPicks();

  const queue = new PQueue({ concurrency: CONCURRENCY_LIMIT });
  const allLogs: TweetLogMap[] = [];
  // Each candidate is stored at its own index rather than pushed. The posts run
  // concurrently, so pushing on completion would return them in whatever order
  // they happened to finish. Submission goes in this order, so it has to stay
  // the order `items` came in. That order is the selection ranking: curated
  // topic posts first, then by feed tier, then by velocity.
  const candidateByIndex: (Candidate | undefined)[] = new Array(items.length);
  const skippedByIndex: (Post | undefined)[] = new Array(items.length);

  for (const [idx, item] of items.entries()) {
    // A post from the misinfo pre-pass carries a MonitoringContext. For those we
    // record that the post came from monitoring and which topic it matched. A
    // regular post forces neither pick and lands on the defaults, which are "no"
    // and "none".
    const monitoringPicks: Record<string, string> = item.monitoring
      ? { misinfo_monitoring: "yes", misinfo_topic: item.monitoring.topicId }
      : {};
    // The feed tier is not sampled, because it is already decided at fetch time.
    // So we force feed_size to the tier this post actually came from.
    const feedSizePick: Record<string, string> = item.feedSize ? { feed_size: item.feedSize } : {};
    const perPostPicks = { ...outerForcedPicks, ...feedSizePick, ...monitoringPicks };
    queue.add(() => withForcedPicks(perPostPicks, () => withMonitoringContext(item.monitoring, async () => {
      // The deadline is checked the moment the post would start, not when it
      // was enqueued. Work already in flight is left to finish; what the
      // deadline cuts is only the posts nobody has touched yet.
      if (deadlineMs && Date.now() >= deadlineMs) {
        skippedByIndex[idx] = item.post;
        return;
      }
      // Any forced picks are already in the async-local store, put there by
      // runPipeline.ts through withForcedPicks. runABTests honours them for
      // whichever tests fire.
      const { config, picks } = runABTests(AB_TESTS);
      const selectedBot = getBotById(config.botId);
      if (!selectedBot) {
        throw new Error(`No bot registered for id "${config.botId}" picked by AB_TESTS`);
      }

      const log = createTweetLog();
      log.set("tweet.index", idx + 1);
      log.set("tweet.total", items.length);
      const rankFeatures = featuresFromPost(item.post, item.velocity, item.feedSize ? REGULAR_FEED_LADDER.indexOf(item.feedSize) : null);
      log.set("ranking.features", rankFeatures);
      log.set("ranking.admission", shadowScores(rankFeatures));

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
        candidateByIndex[idx] = { post: item.post, tweetResult, botId, velocity: item.velocity };
      }
    })));
  }

  // Waiting for stragglers past the deadline is how the hard kill used to land
  // before the submit phase: once every post has started, the start-gate above
  // has nothing left to cut, and one slow post holds the whole run hostage
  // until the 27-minute kill (observed 2026-08-27: a 9-post batch sat on its
  // tail with two finished notes and lost both). So at the deadline we stop
  // waiting, drop whatever has not started, and hand back the candidates that
  // are finished, in selection order — the submit phase gets its five minutes.
  // Posts still in flight keep running to no useful end; their rows are swept
  // as not_completed by the next run, exactly as under the hard kill.
  if (deadlineMs) {
    const msLeft = deadlineMs - Date.now();
    if (msLeft > 0) {
      await Promise.race([queue.onIdle(), new Promise<void>((r) => setTimeout(r, msLeft))]);
    }
    if (queue.size > 0 || queue.pending > 0) {
      const notStarted = queue.size;
      queue.clear();
      console.log(
        `[${label}] soft deadline: stopped waiting — ${queue.pending} post(s) abandoned in flight, ` +
          `${notStarted} never started; submitting what is finished`,
      );
    }
  } else {
    await queue.onIdle();
  }

  const skipped = skippedByIndex.filter((p): p is Post => p !== undefined);
  if (skipped.length > 0) {
    // Say exactly what the clock cut, so a thin batch reads as a deadline
    // decision in the logs and never as coverage.
    console.log(
      `[${label}] soft deadline: ${skipped.length} of ${items.length} post(s) never started — ` +
        skipped.map((p) => p.id).join(", "),
    );
  }

  const candidates = candidateByIndex.filter((c): c is Candidate => c !== undefined);

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
  /** The soft deadline for starting new posts, passed through to processPosts.
   *  See ProcessPostsOptions.deadlineMs. */
  deadlineMs?: number;
  /** These are pre-fetched by runPipeline and shared with the misinfo pre-pass,
   *  so the notes, pipeline_runs and tweets tables are not scanned twice in one
   *  run. A caller that leaves them out makes fetchPosts fetch them instead. */
  skipPostIds?: Set<string>;
  knownTweetIds?: Set<string>;
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
  /** Ranks fetched posts across tiers. Null keeps the tier-then-velocity ladder. */
  scorer?: Scorer | null;
  /** The curated topics to match the regular pool against. A confirmed post gets
   *  the full monitoring treatment, answers to the topic velocity floor instead
   *  of the regular one, and takes a bounded share of maxPosts. See
   *  regularFeedTopicCuration.ts. An empty or missing list turns curation off
   *  completely. */
  topicIds?: readonly MisinfoTopicId[];
}

export async function generateCandidates(
  supabaseLogger: SupabaseLogger | null,
  { maxPosts, deadlineMs, skipPostIds, knownTweetIds, onTweetProcessed, topicIds, scorer = null }: GenerateCandidatesOptions,
): Promise<Candidate[]> {
  const outerForcedPicks = getForcedPicks();
  if (Object.keys(outerForcedPicks).length > 0) {
    console.log(`[generate] Forced picks: ${JSON.stringify(outerForcedPicks)}`);
  }
  const botProbs = getBotProbabilities();
  const activeBots = botProbs.filter((b) => b.probability > 0);
  console.log(`[generate] Bots: ${activeBots.map((b) => `${b.id} ${b.probability.toFixed(1)}%`).join(", ")}`);

  const { selected, fresh } = await fetchPosts(supabaseLogger, maxPosts, skipPostIds, knownTweetIds, scorer);
  if (scorer) console.log(`[generate] Ranking policy ${scorer.name}: selected across tiers`);

  // Archive every new post the ladder surfaced into feed_tweets, including the
  // posts below the floor. The archive freezes the impressions and the tier as
  // they were at first sight. It is the record of supply that floor analyses
  // replay, so we can ask what could have been selected under a different floor.
  // The tweets table cannot hold this, because it doubles as the ledger of posts
  // we must not fetch again. If the archive write fails the run carries on. The
  // failure shows up in the run log, and it must never cost us a note run.
  if (supabaseLogger && fresh.length) {
    try {
      const archived = await supabaseLogger.insertNewFeedTweets(fresh);
      console.log(`[generate] Archived ${archived.size} new feed post(s) to feed_tweets`);
    } catch (err) {
      console.warn("[generate] feed_tweets archive failed; continuing:", err);
    }
  }

  // Match the curated topics over the whole fresh pool, including the posts
  // below the regular floor. A confirmed topic post answers to the lower topic
  // floor, which fillWithTopicPriority applies, and not to the regular floor. A
  // topic post whose velocity sits between the two floors is exactly the case
  // the wider pool exists for. If curation fails the regular pass carries on.
  // The selection LLM inside it throws on output it cannot recover, which is
  // deliberate, and a failure here must never take the regular pass down. The
  // sightings left unjudged are simply evaluated again next run.
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

  // Record only the posts we are about to process. The tweets table is the
  // ledger of posts we have already handled and must not fetch again. Recording
  // everything the ladder walked past would therefore burn every below-floor
  // post on first sight, and a post that is slow now may be worth a note once it
  // takes off. The full feed pull is archived separately, in feed_tweets. This
  // runs after curation, so a regular post that curation displaced is not burned
  // and a prioritized topic post is.
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

  // A confirmed post gets the same MonitoringContext a pre-pass topic post gets.
  // The reference document is injected, the eval gate becomes advisory, the
  // prefilter is bypassed, and the run records the misinfo_topic pick.
  // Everything downstream keys off item.monitoring.
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

  // Stamp the sightings of curated posts as processed. This is the same
  // bookkeeping the pre-pass does, and it is what drives topic attribution.
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
    deadlineMs,
  });
  // Tag curated candidates the way pre-pass ones are tagged, so that
  // submitCandidates leaves them out of its velocity-floor backstop. They answer
  // to the lower topic floor, which fillWithTopicPriority already applied. This
  // is done here rather than in the shared processPosts, because the other
  // callers of processPosts, such as the pangram pre-pass, must not inherit it.
  return candidates.map((c) => (curatedInRun.has(c.post.id) ? { ...c, isMisinfo: true } : c));
}
