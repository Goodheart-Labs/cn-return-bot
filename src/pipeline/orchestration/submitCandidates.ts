/**
 * Submit Candidates
 *
 * Submits candidates via the X API in priority order. Base order is eval score
 * descending. On top of that, a bounded number of the best *misinfo* (curated-
 * topic, e.g. Trump) notes are pushed to the very front — see the reserve below.
 * In dry-run mode, just logs what would be submitted.
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import { submitNoteForTweet } from "./submitNoteForTweet";
import type { Post } from "../../api/fetchEligiblePosts";
import type { ProcessTweetResult } from "./processTweet";

// ── Misinfo submit-priority reserve ─────────────────────────────────────────
// Misinfo notes (curated topics like Trump election-security) run an *advisory*
// eval gate — they become candidates even when X scores them low. But the submit
// order is eval-descending, so on a saturated day (submissions already at X's
// ~20/24h cap) a low-eval misinfo note sorts to the bottom and gets cut. This
// reserve pushes up to MISINFO_RESERVE_24H of the *best* misinfo notes to the
// front so they get a slot despite saturation.
//
// It is DELIBERATELY BOUNDED to ~10% of the daily cap (2 of ~20) over a rolling
// 24h window: misinfo is high-value (≈10× the views of a standard note) but
// high-variance (may rate poorly → dilutes hit rate → *lowers* the future cap,
// X's anti-spam lever). Bounding the boost keeps 90% of slots on the proven
// regular flow. Set MISINFO_RESERVE_24H = 0 to disable the reserve entirely.
const MISINFO_RESERVE_24H = 2;
// Only misinfo notes with eval ≥ this floor ride the reserve. Default -Infinity
// (no floor) for v1: a floor at/above the gate threshold (0) would exclude
// exactly the low-eval misinfo notes the advisory gate is meant to rescue —
// self-defeating until we've observed how X actually scores Trump notes. The
// 24h bound above is the real safety; raise this knob once we have that data.
const MISINFO_RESERVE_EVAL_FLOOR = -Infinity;
const SUBMISSION_WINDOW_HOURS = 24;

const evalOf = (c: Candidate) => c.tweetResult.evaluationScore ?? -Infinity;
const byEvalDesc = (a: Candidate, b: Candidate) => evalOf(b) - evalOf(a);

export interface Candidate {
  post: Post;
  tweetResult: ProcessTweetResult;
  botId: string;
  /** Note classification tags. Defaults to ["disputed_claim_as_fact"] (the
   *  regular fact-check pipeline); the Pangram pre-pass sets
   *  ["missing_important_context"] since X has no AI-generated tag. */
  misleadingTags?: string[];
  /** notes.source_url when the candidate has no bot pipelineResult to read it
   *  from (the Pangram pre-pass sets the report link here). */
  sourceUrl?: string;
  /** True for misinfo-monitoring (curated-topic) candidates. Drives the bounded
   *  submit-priority reserve above. Set in generateMisinfoCandidates. */
  isMisinfo?: boolean;
}

/**
 * Order candidates for submission: base is eval descending, but push up to a
 * bounded number of the best misinfo notes to the front so a saturated cap
 * doesn't starve them (see the reserve constants above). Fail-soft — any error
 * reading the 24h misinfo count falls back to plain eval-sort (no boost).
 */
async function orderForSubmission(
  candidates: Candidate[],
  supabaseLogger: SupabaseLogger,
): Promise<Candidate[]> {
  if (MISINFO_RESERVE_24H <= 0) return [...candidates].sort(byEvalDesc);

  let reserveRemaining = 0;
  try {
    const already = await supabaseLogger.countRecentMisinfoSubmissions(SUBMISSION_WINDOW_HOURS);
    reserveRemaining = Math.max(0, MISINFO_RESERVE_24H - already);
  } catch (err) {
    console.warn("[submit] misinfo reserve count failed; no boost this run:", err);
    return [...candidates].sort(byEvalDesc);
  }
  if (reserveRemaining === 0) return [...candidates].sort(byEvalDesc);

  const boosted = candidates
    .filter((c) => c.isMisinfo && evalOf(c) >= MISINFO_RESERVE_EVAL_FLOOR)
    .sort(byEvalDesc)
    .slice(0, reserveRemaining);
  if (boosted.length === 0) return [...candidates].sort(byEvalDesc);

  const boostedSet = new Set(boosted);
  const rest = candidates.filter((c) => !boostedSet.has(c)).sort(byEvalDesc);
  console.log(
    `[submit] misinfo reserve: boosted ${boosted.length} note(s) to front ` +
      `(24h reserve ${MISINFO_RESERVE_24H - reserveRemaining}/${MISINFO_RESERVE_24H} used) — ` +
      `evals ${boosted.map((c) => evalOf(c).toFixed(2)).join(", ")}`,
  );
  return [...boosted, ...rest];
}

export async function submitCandidates(
  candidates: Candidate[],
  supabaseLogger: SupabaseLogger,
  dryRun: boolean
): Promise<number> {
  const inCI = !!process.env.CI;
  if (inCI) {
    console.log("::endgroup::");
    console.log("::group::Submit results");
  }

  try {
    const ordered = await orderForSubmission(candidates, supabaseLogger);

    console.log(`[submit] ${ordered.length} candidates to submit (eval-sorted, misinfo reserve applied)`);

    if (dryRun) {
      for (const c of ordered) {
        console.log(`[submit]   (dry run) eval=${c.tweetResult.evaluationScore?.toFixed(2) ?? "?"}${c.isMisinfo ? " [misinfo]" : ""} | ${c.post.id}`);
      }
      return 0;
    }

    let submitted = 0;
    let expired = 0;
    let errors = 0;
    let limitHit = false;
    let limitSkipped = 0;

    for (const candidate of ordered) {
      const evalStr = candidate.tweetResult.evaluationScore?.toFixed(2) ?? "?";
      const result = await submitNoteForTweet(candidate, supabaseLogger);

      if (result.status === "submitted") {
        submitted++;
        console.log(`[submit] submitted ${candidate.post.id} (eval=${evalStr}) → note ${result.noteId}`);
      } else if (result.status === "daily_limit") {
        limitHit = true;
        console.log(`[submit] daily limit reached after ${submitted} submissions`);
        const remaining = ordered.slice(ordered.indexOf(candidate) + 1);
        limitSkipped = remaining.length + 1;
        for (const r of remaining) {
          if (r.tweetResult.pipelineRunId) {
            try {
              await supabaseLogger.completePipelineRun(r.tweetResult.pipelineRunId, {
                outcome: "rejected",
                outcome_reason: "daily_limit_reached",
                final_stage: "submission",
              });
            } catch {}
          }
        }
        break;
      } else if (result.status === "expired") {
        expired++;
        console.log(`[submit] expired ${candidate.post.id} (${result.reason}) — skipping`);
      } else {
        errors++;
        console.log(`[submit] error ${candidate.post.id}: ${result.message} — will not retry`);
      }
    }

    const breakdown = [
      `${submitted} submitted`,
      expired ? `${expired} expired` : null,
      errors ? `${errors} errors` : null,
      limitHit ? `${limitSkipped} skipped (daily limit)` : null,
    ].filter(Boolean).join(", ");
    console.log(`[submit] result: ${breakdown}`);

    return submitted;
  } finally {
    if (inCI) console.log("::endgroup::");
  }
}
