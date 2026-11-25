/**
 * The first account's Pangram pass (GOO-880). Pangram is a commercial
 * AI-text detector. The first X account's writer (writer.ts) runs this pass
 * after every walk of the feed, before it picks posts for ordinary notes.
 *
 * It looks at every post of the walk, XL and the part of XXL the walk read
 * (src/feed-views/walk.ts). The ordinary notes look only at XL.
 *
 * In July 2026 we wrote a fixed note, "According to Pangram this post is AI
 * generated", on every long-form post Pangram called AI. Raters found most of
 * those notes unhelpful: opinion posts, real news, official statements, jokes
 * and personal stories, where it does not matter who typed the words. So now
 * a Claude judges each such post first, and the note goes out only when the
 * judge expects it to be rated helpful (src/claude-notes/jobs/pangram.ts).
 * Jim wants about PANGRAM_NOTES_PER_DAY of these notes a day, because notes
 * rated unhelpful lower the account's writing limit.
 *
 * Each walk it
 *   1. keeps each long-form post's best predicted views still to come, in
 *      memory and in pangram_feed_scores (migration 204),
 *   2. stops when the last 24 hours already have PANGRAM_NOTES_PER_DAY
 *      Pangram notes, counting the ones still with the judge,
 *   3. sets a views threshold that lets through just enough long-form posts
 *      for PANGRAM_NOTES_PER_DAY notes a day at the Pangram note rate
 *      (src/pipeline/utils/viewsThreshold.ts),
 *   4. sends each long-form post above the threshold to Pangram, best first,
 *      unless Pangram checked it before, the account handled it, or the WSDM
 *      Cup account would take it (competition.ts), and
 *   5. hands each post Pangram calls AI to the Claude judge on the runner,
 *      until the day's notes are used up.
 * Every Pangram verdict is recorded in pangram_monitoring_sightings, so no
 * post goes to Pangram twice. A Pangram request that fails throws. The post
 * then gets no verdict and is tried again on the next walk.
 */

import type { SupabaseLogger } from "../api/supabaseClient";
import { getSupabaseClient } from "../api/supabaseClient";
import { currentXAccount } from "../api/xAccount";
import { claudeUnavailableReason } from "../claude-notes/xShare";
import { fetchAllRows } from "../everything-core/paging";
import type { WalkResult } from "../feed-views/walk";
import { pickVariantName } from "../pipeline/ab-testing/abTests";
import { PANGRAM_NOTE_TEST } from "../pipeline/ab-testing/abTestsData";
import { PANGRAM_BOT } from "../pipeline/orchestration/claudeTweets";
import { classifyText, type PangramVerdict } from "../pipeline/pangram-monitoring/pangramClient";
import { PANGRAM_APPROVED } from "../pipeline/pangram-monitoring/pangramNote";
import { formatViewsToCome } from "../pipeline/utils/viewsToCome";
import { postsPerDay, SCORE_HISTORY_DAYS, viewsThreshold } from "../pipeline/utils/viewsThreshold";
import { fetchClaimCheckHealth, requestTweetInput } from "../service/client";
import { addScores, type BestScore, longFormScored, type PangramCandidate, pickForPangram, scoreHistory } from "./pangramPick";

/** Jim's limit: "maybe 3 per day" (GOO-880). */
export const PANGRAM_NOTES_PER_DAY = 3;
const DAY_MS = 24 * 3_600_000;
/** Bounds one walk's Pangram requests, in case the threshold is far too low. */
const MAX_CHECKS_PER_WALK = 10;
/** The judge started on this day. The verdicts before it come from the July
 *  2026 pre-pass, which had no judge, so they say nothing about the note rate. */
const JUDGE_STARTED_AT = "2026-11-25T00:00:00Z";
/** The note rate comes from the last this many Pangram checks. */
const CHECKS_FOR_NOTE_RATE = 100;
/** With fewer checks than this, the pass uses STARTING_NOTE_RATE. */
const MIN_CHECKS_FOR_NOTE_RATE = 50;
/** In July, Pangram called 47 of 220 long-form posts AI. If the judge approves
 *  about one in four of those, 5% of the checked posts get a note. */
const STARTING_NOTE_RATE = 0.05;
/** At most 150 Pangram checks a day for 3 notes. */
const MIN_NOTE_RATE = 0.02;
/** The Pangram outcomes that count toward the day's notes: with the judge,
 *  approved and waiting, or submitted. */
const OUTCOMES_COUNTED_PER_DAY = ["in_progress", "candidate", "submitted"];

const db = () => getSupabaseClient();

async function readHistory(nowMs: number): Promise<Map<string, BestScore>> {
  const since = new Date(nowMs - SCORE_HISTORY_DAYS * DAY_MS).toISOString();
  const rows = await fetchAllRows<{ tweet_id: string; first_seen_at: string; best_views_to_come: number }>(
    () => db().from("pangram_feed_scores").select("tweet_id, first_seen_at, best_views_to_come").gte("first_seen_at", since),
    "tweet_id",
    { label: "pangramHistory" },
  );
  return new Map(rows.map((r) => [r.tweet_id, { firstSeenAt: Date.parse(r.first_seen_at), best: r.best_views_to_come }]));
}

async function saveScores(changed: [string, BestScore][]): Promise<void> {
  if (!changed.length) return;
  const rows = changed.map(([tweetId, { firstSeenAt, best }]) => ({ tweet_id: tweetId, first_seen_at: new Date(firstSeenAt).toISOString(), best_views_to_come: best }));
  const { error } = await db().from("pangram_feed_scores").upsert(rows, { onConflict: "tweet_id" });
  if (error) throw new Error(`Could not store the Pangram scores: ${error.message}`);
}

/** The Pangram notes of the last 24 hours, counting the ones still with the judge. */
async function countRecentPangramNotes(): Promise<number> {
  const { count, error } = await db()
    .from("pipeline_runs")
    .select("id", { count: "exact", head: true })
    .eq("x_account", currentXAccount())
    .eq("bot_name", PANGRAM_BOT)
    .in("outcome", OUTCOMES_COUNTED_PER_DAY)
    .gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
  if (error) throw new Error(`Could not count the recent Pangram notes: ${error.message}`);
  return count ?? 0;
}

/** The share of the last Pangram checks that ended with a note the judge
 *  approved, or STARTING_NOTE_RATE while there are too few checks. */
async function readNoteRate(): Promise<number> {
  const { data: checks, error } = await db()
    .from("pangram_monitoring_sightings")
    .select("processed_run_id")
    .gte("checked_at", JUDGE_STARTED_AT)
    .order("checked_at", { ascending: false })
    .limit(CHECKS_FOR_NOTE_RATE);
  if (error) throw new Error(`Could not read the Pangram checks: ${error.message}`);
  if (checks.length < MIN_CHECKS_FOR_NOTE_RATE) return STARTING_NOTE_RATE;
  const runIds = checks.map((c) => c.processed_run_id).filter((id): id is string => !!id);
  if (!runIds.length) return 0;
  const { data: notes, error: notesError } = await db().from("pipeline_runs").select("id").in("id", runIds).not("note_text", "is", null);
  if (notesError) throw new Error(`Could not read the Pangram notes: ${notesError.message}`);
  return notes.length / checks.length;
}

async function readCheckedTweetIds(): Promise<Set<string>> {
  const rows = await fetchAllRows<{ tweet_id: string }>(() => db().from("pangram_monitoring_sightings").select("tweet_id"), "tweet_id", { label: "pangramChecked" });
  return new Set(rows.map((r) => r.tweet_id));
}

type Classified = Extract<PangramVerdict, { type: "classified" }>;

export class PangramPass {
  private history: Map<string, BestScore> | null = null;
  private checked: Set<string> | null = null;

  constructor(private readonly logger: SupabaseLogger) {}

  /** `leftToOthers` are the posts the WSDM Cup account would take. */
  async afterWalk(walk: WalkResult, scores: Map<string, number | null>, leftToOthers: ReadonlySet<string>): Promise<void> {
    const nowMs = walk.finishedAt.getTime();
    this.history ??= await readHistory(nowMs);
    const xxlOnly = walk.xxlReadings.map(({ post }) => ({ post, tier: "xxl" as const }));
    const scored = longFormScored([...walk.readings, ...xxlOnly], scores);
    await saveScores(addScores(this.history, scored, nowMs));

    const slots = PANGRAM_NOTES_PER_DAY - (await countRecentPangramNotes());
    if (slots <= 0) {
      console.log(`[pangram] the last 24 hours have ${PANGRAM_NOTES_PER_DAY} Pangram notes; no Pangram checks until one is older`);
      return;
    }
    const history = scoreHistory(this.history, nowMs);
    const noteRate = await readNoteRate();
    const wantedPerDay = postsPerDay(PANGRAM_NOTES_PER_DAY, noteRate, MIN_NOTE_RATE);
    const threshold = viewsThreshold(history, wantedPerDay);
    console.log(
      `[pangram] threshold ${threshold === null ? "not set yet" : formatViewsToCome(threshold)} views to come: ` +
        `${history.bestScores.length} long-form posts in ${history.hours.toFixed(1)} hours, ` +
        `${wantedPerDay.toFixed(0)} checks a day at a note rate of ${(noteRate * 100).toFixed(1)}%; ${slots} note(s) left today`,
    );
    if (threshold === null) return;

    this.checked ??= await readCheckedTweetIds();
    const unchecked = pickForPangram(scored.filter((s) => !leftToOthers.has(s.post.id)), this.checked, threshold, Infinity);
    if (!unchecked.length) return;
    const handled = await this.logger.getKnownTweetIds(unchecked.map((s) => s.post.id));
    const picked = pickForPangram(unchecked, handled, threshold, MAX_CHECKS_PER_WALK);
    if (!picked.length) return;
    // A post Pangram calls AI would go to the judge at once, so nothing is
    // checked while the judge could not take it.
    if (await claudeUnavailableReason()) return;
    // The claim-check service builds the judge's input.
    await fetchClaimCheckHealth();

    let left = slots;
    for (const candidate of picked) {
      if (left === 0) break;
      if (await this.check(candidate)) left--;
    }
  }

  /** Sends one post to Pangram and records the verdict. Returns whether the
   *  post went to the judge. */
  private async check(candidate: PangramCandidate): Promise<boolean> {
    const { post } = candidate;
    const verdict = await classifyText(post.text);
    if (verdict.type === "error") throw new Error(`Pangram could not classify ${post.id}: ${verdict.error}`);
    const isAi = verdict.predictionShort === "AI";
    const runId = isAi ? await this.handToJudge(candidate, verdict) : undefined;
    await this.logger.recordPangramChecks([{
      tweet_id: post.id,
      feed_size: candidate.tier,
      impression_count: post.public_metrics?.impression_count,
      author_name: post.author_name,
      prediction_short: verdict.predictionShort,
      fraction_ai: verdict.fractionAi,
      is_ai: isAi,
      processed_run_id: runId,
    }]);
    this.checked!.add(post.id);
    console.log(`[pangram] ${post.id} (${formatViewsToCome(candidate.viewsToCome)} to come): Pangram says ${verdict.predictionShort}${isAi ? ", so it goes to the judge" : ""}`);
    return isAi;
  }

  /** Creates the post's run and leaves it waiting for the judge. When the
   *  judge's input cannot be built, the run fails and the post is not tried again. */
  private async handToJudge(candidate: PangramCandidate, verdict: Classified): Promise<string> {
    const { post } = candidate;
    await this.logger.bulkInsertNewTweets([post]);
    const picks = { pangram_monitoring: "yes", pangram_note: pickVariantName(PANGRAM_NOTE_TEST), feed_size: candidate.tier };
    const runId = await this.logger.createPipelineRun({ tweet_id: post.id, bot_name: PANGRAM_BOT, ab_test_picks: picks });
    const logs = {
      pangram: { prediction: verdict.predictionShort, fraction_ai: verdict.fractionAi, headline: verdict.headline, dashboard_link: verdict.dashboardLink },
      views_to_come: candidate.viewsToCome,
    };
    try {
      const { input } = await requestTweetInput({ priority: "x", post });
      await this.logger.markRunWaitingForClaude(runId, { bot: PANGRAM_BOT, picks, logs: { ...logs, claude: { input } } });
    } catch (err) {
      const message = `Could not build the input for the Pangram judge: ${(err as Error).message ?? String(err)}`;
      console.warn(`[pangram] ${post.id} failed: ${message}`);
      await this.logger.completePipelineRun(runId, { outcome: "failed", outcome_reason: "claude_input_failed", error_message: message.slice(0, 2000), final_stage: "error", bot_name: PANGRAM_BOT, ab_test_picks: picks, logs });
    }
    return runId;
  }
}

/** The approved Pangram notes that wait for the writer to submit them, oldest first. */
export async function approvedPangramNotes(): Promise<{ id: string; tweet_id: string; note_text: string; source_url: string; created_at: string }[]> {
  const { data, error } = await db()
    .from("pipeline_runs")
    .select("id, tweet_id, note_text, source_url, created_at")
    .eq("x_account", currentXAccount())
    .eq("bot_name", PANGRAM_BOT)
    .eq("outcome", "candidate")
    .eq("outcome_reason", PANGRAM_APPROVED)
    .order("created_at");
  if (error) throw new Error(`Could not read the approved Pangram notes: ${error.message}`);
  return data as { id: string; tweet_id: string; note_text: string; source_url: string; created_at: string }[];
}
