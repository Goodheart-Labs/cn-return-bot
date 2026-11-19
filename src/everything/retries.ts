/* When a post that could not be read gets another attempt. Since the post
 * list (GOO-791) only the intake service's read of a post can fail it, so
 * these rules decide when cn-walk puts such a post back for intake to read
 * again. */

import type { ItemOutcome, RetryableErrorItem } from "./db";

/** How long an errored item rests after its last failure before each repeat
 *  attempt. The retries come 1, 3 and 12 hours after the first attempt. A
 *  video tried within an hour of its upload often has no captions yet. Of 14
 *  such videos that got captions later, 9 had them 3 hours after the first
 *  attempt and 5 only 12 hours after it (GOO-422). The retry after 1 hour was
 *  added on 2026-10-23, so a passing failure delays a new post by an hour
 *  instead of three (GOO-549). */
export const RETRY_WAIT_HOURS = [1, 2, 9] as const;

/** How many repeat attempts an errored item gets before it stays an error a
 *  human has to look at. */
export const MAX_ITEM_RETRIES = RETRY_WAIT_HOURS.length;

/** Which attempt a retry of the item is, for the log: "2/4", "3/4" or "4/4",
 *  and "5, its source was down" for an attempt beyond the listed ones
 *  (fetchRetryableErrorItems). */
export const attemptLabel = (item: Pick<RetryableErrorItem, "retries">) =>
  item.retries < MAX_ITEM_RETRIES ? `${item.retries + 2}/${MAX_ITEM_RETRIES + 1}` : `${item.retries + 2}, its source was down`;

/** How far back cn-walk looks to decide that a source is failing. */
export const FAILING_SOURCE_WINDOW_MS = 3600_000;

/** The sources whose posts all failed lately: at least two of a source's
 *  posts failed in the last hour and none was read. On 2026-11-16 YouTube
 *  served no captions, every video failed, and each came back for its three
 *  repeat attempts at once. A failing source gets only a few repeat attempts
 *  per pass, so a source that recovers is found within the hour and its posts
 *  keep their attempts meanwhile. */
export function failingSources(outcomes: ItemOutcome[]): Set<string> {
  const failed = new Map<string, number>();
  for (const o of outcomes) if (o.outcome === "failed") failed.set(o.source, (failed.get(o.source) ?? 0) + 1);
  for (const o of outcomes) if (o.outcome === "read") failed.delete(o.source);
  return new Set([...failed].filter(([, count]) => count >= 2).map(([source]) => source));
}
