/**
 * Rescue stranded candidates.
 *
 * A run assembles its candidates in memory and submits them all at the very
 * end. When the 27-minute runtime guard or a crash kills the process before
 * the submit phase, those finished notes survive only as pipeline_runs rows
 * with outcome 'candidate' — and until this module existed, nothing ever
 * picked them up again. On 2026-08-26 that stranded 37 finished notes against
 * 46 submitted; the day before was the same shape. Roughly half of what the
 * bot wrote was thrown away by the clock.
 *
 * runPipeline calls rescueStrandedCandidates at the START of the next run and
 * submits what it returns before generating anything, so a run's own death can
 * only ever cost unwritten work, never finished notes. A rescued candidate
 * carries just enough to submit: the tweet id, the note text, and the run row
 * to update. It goes back through submitCandidates, so the velocity floor and
 * the stale-tweet cutoff are checked again exactly as for a fresh candidate.
 *
 * Only rows older than ORPHAN_MIN_AGE_MINUTES are rescued. The workflow's
 * concurrency group means a predecessor has always finished by the time we
 * run, but a local run bypasses that group, and the sweeper in runPipeline
 * makes the same 30-minute allowance for the same reason. A row that old
 * cannot belong to a run that is still alive, because the runtime guard kills
 * every run at 27 minutes.
 *
 * Rows older than the misinfo stale cutoff are left alone: the strictest
 * cutoff still lets them through here and submitCandidates would only cut
 * them again. They stay 'candidate' in the table, which is also what keeps
 * this query cheap.
 */

import { SupabaseLogger, StrandedCandidateRow } from "../../api/supabaseClient";
import type { Post } from "../../api/fetchEligiblePosts";
import type { Candidate } from "./submitCandidates";
import { MISINFO_STALE_CUTOFF_HOURS } from "./submitCandidates";

export const ORPHAN_MIN_AGE_MINUTES = 30;

/** Turns a stranded row back into the minimal Post the submit path reads: the
 *  id for the API call and the snowflake fallback, posted_at for the stale
 *  cutoff, impressions for the velocity floor. A missing tweets row leaves
 *  created_at empty, which tweetAgeHours resolves from the snowflake, and
 *  leaves the metrics unset, which the velocity floor treats as above-floor.
 *  Both are the documented fail-open directions. */
export function rehydratePost(row: StrandedCandidateRow): Post {
  return {
    id: row.tweet_id,
    author_id: row.tweet?.author_id ?? "",
    created_at: row.tweet?.posted_at ?? "",
    text: row.tweet?.text ?? "",
    media: [],
    public_metrics:
      row.tweet?.impressions != null ? ({ impression_count: row.tweet.impressions } as Post["public_metrics"]) : undefined,
  };
}

/** One rescued candidate per tweet. Retries can leave several candidate rows
 *  on the same tweet; the newest note is the one worth submitting, and once it
 *  is out, the notes-row check in fetchStrandedCandidateRows retires the
 *  others from every later rescue. */
export function dedupeNewestPerTweet(rows: StrandedCandidateRow[]): StrandedCandidateRow[] {
  const newest = new Map<string, StrandedCandidateRow>();
  for (const row of rows) {
    const seen = newest.get(row.tweet_id);
    if (!seen || row.created_at > seen.created_at) newest.set(row.tweet_id, row);
  }
  return [...newest.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function rescueStrandedCandidates(logger: SupabaseLogger): Promise<Candidate[]> {
  const rows = await logger.fetchStrandedCandidateRows(ORPHAN_MIN_AGE_MINUTES, MISINFO_STALE_CUTOFF_HOURS);
  return dedupeNewestPerTweet(rows).map((row) => ({
    post: rehydratePost(row),
    tweetResult: {
      pipelineResult: null,
      outcome: "candidate" as const,
      finalStage: "candidate",
      noteText: row.note_text,
      evaluationScore: row.evaluation_score ?? undefined,
      scores: [],
      pipelineRunId: row.id,
    },
    botId: row.bot_name ?? "rescued",
  }));
}
