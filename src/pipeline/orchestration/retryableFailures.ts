/** Failures that say nothing about the tweet: a model returned prose instead of
 *  JSON, or output the pipeline could not parse. Source fetch failures and
 *  rejections are deliberate outcomes and stay final. Runs the sweeper marked
 *  not_completed are left out for now: at ~55 a day they would double the cost
 *  of the slowest items, and many of them are the 90-second precheck cap doing
 *  its job. Add "not_completed" here to retry those too.
 */
export const RETRYABLE_FAILURE_REASONS: ReadonlySet<string> = new Set(["bot_error", "model_output_invalid"]);
/** Total attempts a tweet gets, so one retry. */
const MAX_ATTEMPTS = 2;
/** Only tweets this fresh are worth another pass; older ones have left the feed. */
export const RETRY_WINDOW_HOURS = 48;
/** The failed row is written when processing starts, so a cooldown keeps the
 *  very next run from picking the tweet up while the sweeper is still deciding. */
const RETRY_COOLDOWN_MINUTES = 20;

export interface RunRow {
  tweet_id: string;
  outcome: string;
  outcome_reason: string | null;
  created_at: string;
}

/** Tweet ids whose every run in the window failed for a retryable reason, with
 *  fewer than MAX_ATTEMPTS runs, the latest older than the cooldown. Any run
 *  that is in progress, rejected, submitted or failed for a final reason keeps
 *  the tweet out, so this can only ever re-run a genuinely wasted attempt. */
export function retryEligibleTweetIds(runs: RunRow[], now: number = Date.now()): Set<string> {
  const windowStart = now - RETRY_WINDOW_HOURS * 3_600_000;
  const cooldownEnd = now - RETRY_COOLDOWN_MINUTES * 60_000;
  const byTweet = new Map<string, RunRow[]>();
  for (const run of runs) {
    if (!run.tweet_id || Date.parse(run.created_at) < windowStart) continue;
    const list = byTweet.get(run.tweet_id) ?? [];
    list.push(run);
    byTweet.set(run.tweet_id, list);
  }
  const eligible = new Set<string>();
  for (const [tweetId, list] of byTweet) {
    if (list.length >= MAX_ATTEMPTS) continue;
    if (!list.every((run) => run.outcome === "failed" && RETRYABLE_FAILURE_REASONS.has(run.outcome_reason ?? ""))) continue;
    if (list.some((run) => Date.parse(run.created_at) > cooldownEnd)) continue;
    eligible.add(tweetId);
  }
  return eligible;
}
