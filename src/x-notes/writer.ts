/**
 * The X note writer for the first account, stilt (GOO-865, GOO-880). The
 * feed daemon (src/feed-views/main.ts) calls it after every walk of the feed,
 * so every 10 minutes. From GOO-874 to GOO-880 the account wrote no notes.
 * Since GOO-880 it writes Claude Code notes only, never pipeline notes, and
 * Pangram notes. Each round it
 *   1. sweeps runs that never finished and closes notes that waited too long
 *      in the note queue,
 *   2. submits the Pangram notes the judge approved, then the notes in the
 *      note queue, best first by the note rater, until X has no room
 *      (submitCandidates),
 *   3. leaves out the posts the WSDM Cup account would take (competition.ts),
 *   4. runs the Pangram pass (pangram.ts), which sends long-form posts to
 *      Pangram and the ones it calls AI to the Claude judge,
 *   5. works out how many more tweets to hand to Claude: enough to fill the
 *      room the writing-limit estimate leaves (computeMaxPosts and
 *      writingLimit.ts), minus the tweets still with Claude,
 *   6. picks that many of the walk's posts (pick.ts) and hands each to the
 *      Claude note writer on the runner. A finished note goes into the note
 *      queue, and the next round submits it.
 *
 * It hands over no new tweets while the account may not use Claude
 * (src/claude-notes/xShare.ts: only what the WSDM Cup account leaves of its
 * share), while the day's checks have cost X_DAILY_SPEND_CAP_USD, while X has
 * no room, or while the claim-check service, which builds Claude's input, is
 * stuck. Queued notes still go out.
 */

import type { SupabaseLogger } from "../api/supabaseClient";
import { claudeUnavailableReason } from "../claude-notes/xShare";
import type { WalkResult } from "../feed-views/walk";
import { getForcedPicks, withForcedPicks } from "../pipeline/ab-testing/abTests";
import { estimateWindow } from "../pipeline/capacity/window";
import { automaticGenerationPreflight } from "../pipeline/capacity/submissionReserve";
import { CLAUDE_CODE_BOT, CLAUDE_TWEET_MAX_WAIT_MINUTES, PANGRAM_BOT } from "../pipeline/orchestration/claudeTweets";
import { computeMaxPosts, fetchRecentChecks, X_DAILY_SPEND_CAP_USD } from "../pipeline/orchestration/computeMaxPosts";
import { processPosts, type SourcedPost } from "../pipeline/orchestration/generateCandidates";
import { loadNoteQueue, QUEUE_MAX_AGE_HOURS, shouldExploreFirst, submittableQueued } from "../pipeline/orchestration/noteQueue";
import { submitCandidates, type Candidate } from "../pipeline/orchestration/submitCandidates";
import { submitNoteForTweet } from "../pipeline/orchestration/submitNoteForTweet";
import { PANGRAM_MISLEADING_TAGS } from "../pipeline/pangram-monitoring/pangramNote";
import { activeScorer, pickRankingPolicy } from "../pipeline/ranking/policy";
import { raterBar } from "../pipeline/score/raterBar";
import { startOfUtcDay } from "../pipeline/utils/utcDay";
import { formatViewsToCome } from "../pipeline/utils/viewsToCome";
import { fetchClaimCheckHealth, queueIsStuck } from "../service/client";
import { readCompetitionFeed } from "./competition";
import { approvedPangramNotes, PangramPass } from "./pangram";
import { competitionPosts, eligiblePosts, pickPosts } from "./pick";

/** Tweets whose Claude input is built at once. The X run ran 10 checks. */
const MAX_PARALLEL_CHECKS = 10;
/** A pipeline run still open after this long belonged to a check that died,
 *  for example in a restart. Longer than any check takes. */
const STUCK_RUN_MINUTES = 60;
/** This many failed checks in a row means something shared is broken, such as
 *  a model provider. Slack hears it once. */
const FAILED_CHECKS_ALARM = 10;
export class XNoteWriter {
  private runningChecks = 0;
  private failedInARow = 0;
  private failureAlarmSent = false;
  private submission: Promise<void> = Promise.resolve();
  private readonly pangram: PangramPass;

  constructor(
    private readonly logger: SupabaseLogger,
    private readonly tellSlack: (text: string) => Promise<void>,
  ) {
    this.pangram = new PangramPass(logger);
  }

  /** One round after a walk. `scores` are the walk's predicted views still to come. */
  async afterWalk(walk: WalkResult, scores: Map<string, number | null>): Promise<void> {
    const swept = await this.logger.sweepStuckRuns({ olderThanMinutes: STUCK_RUN_MINUTES, claudeOlderThanMinutes: CLAUDE_TWEET_MAX_WAIT_MINUTES });
    if (swept > 0) console.log(`[x-notes] swept ${swept} run(s) that never finished`);
    await this.submitQueue();

    // The Pangram pass goes first, so the ordinary notes do not take its
    // posts. A failure of the pass must not stop the ordinary notes, so it is
    // thrown again only at the end of the round.
    const competition = competitionPosts(walk.readings, scores, await readCompetitionFeed());
    console.log(`[x-notes] ${competition.size} post(s) of the walk are left to the WSDM Cup account`);
    const pangramFailure = await this.pangram.afterWalk(walk, scores, competition).then(() => null, (err: unknown) => err);
    await this.handOverTweets(walk, scores, competition);
    if (pangramFailure) throw pangramFailure;
  }

  /** Picks the walk's best new posts and hands them to Claude. */
  private async handOverTweets(walk: WalkResult, scores: Map<string, number | null>, competition: Set<string>): Promise<void> {
    const budget = await this.checkBudget();
    if (budget === 0) return;
    const eligible = eligiblePosts(walk.readings, scores);
    const ids = eligible.map((s) => s.post.id);
    const [known, cooling] = await Promise.all([this.logger.getKnownTweetIds(ids), this.logger.getCooldownTweetIds(ids)]);
    const policy = pickRankingPolicy(undefined);
    const picked = pickPosts(eligible, new Set([...known, ...cooling, ...competition]), budget, activeScorer(policy), walk.finishedAt.getTime());
    console.log(`[x-notes] ${eligible.length} post(s) clear the floor, ${known.size + cooling.size} of them handled before; checking ${picked.length} of a budget of ${budget} (policy ${policy})`);
    if (!picked.length) return;

    // The tweets table is the record of tweets we handled, so a picked tweet is
    // never picked again, also after a restart.
    await this.logger.bulkInsertNewTweets(picked.map((s) => s.post));
    for (const sourced of picked) {
      console.log(`[x-notes]   ${sourced.post.id} | ${sourced.feedSize} | to come=${formatViewsToCome(sourced.viewsToCome)}`);
      void this.check(sourced, policy);
    }
  }

  /** How many new tweets to check now, or 0 when none may be checked. */
  private async checkBudget(): Promise<number> {
    const preflight = await automaticGenerationPreflight(this.logger);
    if (!preflight.allowed) {
      console.log(`[x-notes] no new tweets: ${preflight.reason}`);
      return 0;
    }
    const spent = await this.logger.fetchCostSinceUsd(startOfUtcDay());
    if (spent >= X_DAILY_SPEND_CAP_USD) {
      console.log(`[x-notes] no new tweets: the checks cost $${spent.toFixed(2)} today (UTC), the cap is $${X_DAILY_SPEND_CAP_USD}`);
      return 0;
    }
    // A tweet handed over while Claude is unavailable would fail for good, so
    // no tweet is picked then. The posts wait for a later walk.
    const claudeUnavailable = await claudeUnavailableReason();
    if (claudeUnavailable) {
      console.log(`[x-notes] no new tweets: ${claudeUnavailable}`);
      return 0;
    }
    const health = await fetchClaimCheckHealth();
    if (queueIsStuck(health)) {
      console.log("[x-notes] no new tweets: the claim-check service is stuck");
      return 0;
    }
    const [recent, queued, openClaude] = await Promise.all([
      fetchRecentChecks(this.logger),
      loadNoteQueue(this.logger),
      this.logger.countOpenClaudeTweets(new Date(Date.now() - CLAUDE_TWEET_MAX_WAIT_MINUTES * 60_000)),
    ]);
    const needed = computeMaxPosts(preflight.capacity, recent, submittableQueued(queued, raterBar()).length);
    const budget = Math.max(0, Math.min(needed - this.runningChecks - openClaude, MAX_PARALLEL_CHECKS - this.runningChecks));
    console.log(
      `[x-notes] X has room for ${preflight.capacity.probe ? "1 (cooldown probe)" : preflight.capacity.remaining ?? "an unknown number of"} note(s); ` +
        `filling it takes ${needed} check(s), ${this.runningChecks} run here and ${openClaude} wait on Claude`,
    );
    return budget;
  }

  /** Hands one tweet to Claude in the background. Every tweet draws the
   *  claude-code arm of the bot test, because Jim wants no pipeline notes on
   *  this account (GOO-880). */
  private async check(sourced: SourcedPost, policy: string): Promise<void> {
    this.runningChecks++;
    try {
      const candidates = await withForcedPicks({ ...getForcedPicks(), ranking_policy: policy, bot: CLAUDE_CODE_BOT }, () =>
        processPosts([sourced], this.logger, {
          label: "x-notes",
          onTweetProcessed: (event) => this.countOutcome(event.tweetResult.outcome),
          onTweetFailed: () => this.countOutcome("failed"),
        }));
      const runIds = candidates.map((c) => c.tweetResult.pipelineRunId).filter((id): id is string => !!id);
      if (runIds.length) {
        await this.logger.markRunsQueued(runIds);
        // A failure here is not the check's; the next round submits the queue again.
        await this.submitQueue().catch((err) => console.error("[x-notes] submitting the queue failed:", err));
      }
    } catch (err) {
      console.error(`[x-notes] the check of ${sourced.post.id} failed:`, err);
      await this.countOutcome("failed");
    } finally {
      this.runningChecks--;
    }
  }

  private async countOutcome(outcome: string): Promise<void> {
    if (outcome !== "failed") {
      this.failedInARow = 0;
      this.failureAlarmSent = false;
      return;
    }
    this.failedInARow++;
    if (this.failedInARow < FAILED_CHECKS_ALARM || this.failureAlarmSent) return;
    this.failureAlarmSent = true;
    await this.tellSlack(`The X note writer's last ${this.failedInARow} tweet checks all failed. Their reasons are in pipeline_runs.error_message and in journalctl -u cn-feed-views.`);
  }

  /** Submits the note queue. Calls never overlap: each waits for the one
   *  before. A failure rejects this call, so a round fails and the silence
   *  watch hears of it, but does not stop the next call. */
  private submitQueue(): Promise<void> {
    const run = this.submission.then(() => this.submitQueueNow());
    this.submission = run.catch(() => undefined);
    return run;
  }

  private async submitQueueNow(): Promise<void> {
    if (!(await this.submitPangramNotes())) return;
    const queued = await loadNoteQueue(this.logger);
    if (!queued.length) return;
    const policy = pickRankingPolicy(undefined);
    const bar = raterBar();
    const [window, exploreFirst] = await Promise.all([estimateWindow(this.logger), shouldExploreFirst(this.logger)]);
    const submitted = await withForcedPicks({ ...getForcedPicks(), ranking_policy: policy }, () =>
      submitCandidates(queued, this.logger, false, { policy, scorer: activeScorer(policy), window, bar, barState: bar === null ? "off" : "set", queue: true, exploreFirst }));
    console.log(`[x-notes] submitted ${submitted} of ${queued.length} queued note(s)`);
  }

  /** Submits the Pangram notes the judge approved, oldest first. They skip
   *  the note rater and its bar, because the judge already decided. They go
   *  before the queue, because at most PANGRAM_NOTES_PER_DAY of them come a
   *  day. Returns false when X refused one for the daily limit. */
  private async submitPangramNotes(): Promise<boolean> {
    for (const run of await approvedPangramNotes()) {
      if (Date.parse(run.created_at) < Date.now() - QUEUE_MAX_AGE_HOURS * 3_600_000) {
        await this.logger.markCandidateExpired(run.id, "queue_expired");
        continue;
      }
      const candidate: Candidate = {
        post: { id: run.tweet_id, author_id: "", created_at: "", text: "", media: [] },
        botId: PANGRAM_BOT,
        misleadingTags: PANGRAM_MISLEADING_TAGS,
        sourceUrl: run.source_url,
        tweetResult: { pipelineResult: null, outcome: "candidate", finalStage: "candidate", noteText: run.note_text, pipelineRunId: run.id, scores: [] },
      };
      const result = await submitNoteForTweet(candidate, this.logger);
      console.log(`[x-notes] Pangram note on ${run.tweet_id}: ${result.status}`);
      if (result.status === "daily_limit") return false;
    }
    return true;
  }
}
