/**
 * Curated-topic matching on the REGULAR feed pool.
 *
 * The XXL pre-pass (generateMisinfoCandidates) discovers topic posts by
 * crawling the big feeds, but topic posts also arrive through the regular
 * pass's own pool — where, until now, they were processed as generic posts:
 * no reference document, no topic tagging, no sightings attribution. This
 * module gives the regular pass the same stage-1 keyword match and stage-2
 * selection-LLM judgment, so confirmed topic posts get the full monitoring
 * treatment (document injection, advisory eval gate, topic picks) without
 * adding any processing volume: confirmed posts are guaranteed a bounded
 * number of slots WITHIN the run's existing maxPosts budget.
 *
 * Sightings semantics are shared with the pre-pass (one ledger, one
 * judged-once rule): a pair already judged needs_note=false or already
 * processed is left alone; a pair judged needs_note=true but never processed
 * (e.g. the pre-pass selected it, then dropped it at its cap) reuses the
 * stored verdict here without a second LLM call.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import type { FeedSize } from "../orchestration/utils/feedSizeStrategy";
import { matchPostsByTopic } from "./keywordFilter";
import { selectPostsNeedingNote } from "./selectPostsNeedingNote";
import { MISINFO_TOPICS, type MisinfoTopic } from "./topics";
import type { MisinfoTopicId } from "./topicIds";
import { velocityPerHour } from "../utils/velocity";

/** Confirmed topic matches are guaranteed up to this many of the run's
 *  maxPosts slots (fastest first). They displace the slowest regular picks —
 *  total processing volume is unchanged. Set 0 to keep the matching/tagging
 *  but stop prioritizing. */
export const TOPIC_PRIORITY_SLOTS = 3;

/** Matches generateCandidates' SourcedPost without importing it (that module
 *  imports this one). */
export interface PooledPost {
  post: Post;
  feedSize: FeedSize;
}

/**
 * Match the regular pool against the active topics and return the posts a
 * selection verdict confirms as note-worthy, keyed by tweet id (a post
 * matching several topics is confirmed under the first in MISINFO_TOPICS
 * order — same rule as the pre-pass work list).
 *
 * Callers MUST wrap this fail-soft: selectPostsNeedingNote throws on
 * unrecoverable model output (by design, so unjudged sightings are retried
 * next run), and a curation failure must never take down the regular pass.
 *
 * Note: this adds a second full-ledger getMisinfoSightingKeys read per run
 * (the pre-pass does its own). Fine at current table size; passing the set
 * through from runPipeline is the future optimization.
 */
export async function curateRegularFeedPosts(opts: {
  allNew: PooledPost[];
  supabaseLogger: SupabaseLogger;
  topicIds: readonly MisinfoTopicId[];
}): Promise<Map<string, MisinfoTopic>> {
  const { allNew, supabaseLogger } = opts;
  const confirmed = new Map<string, MisinfoTopic>();
  const topics = MISINFO_TOPICS.filter((t) => opts.topicIds.includes(t.id));
  if (!topics.length || !allNew.length) return confirmed;

  const matched = matchPostsByTopic(allNew.map((s) => s.post));
  if (![...matched.values()].some((posts) => posts.length)) return confirmed;
  const tierById = new Map(allNew.map((s) => [s.post.id, s.feedSize]));

  const [judgedKeys, pendingKeys] = await Promise.all([
    supabaseLogger.getMisinfoSightingKeys(),
    supabaseLogger.getPendingMisinfoSightings(topics.map((t) => t.id)),
  ]);

  for (const topic of topics) {
    const topicPosts = matched.get(topic.id) ?? [];
    if (!topicPosts.length) continue;

    // Reuse stored verdicts; judge only genuinely new pairs. Pairs judged
    // needs_note=false or already processed are excluded entirely.
    const pending = topicPosts.filter((p) => pendingKeys.has(`${p.id}:${topic.id}`));
    const fresh = topicPosts.filter(
      (p) => !pendingKeys.has(`${p.id}:${topic.id}`) && !judgedKeys.has(`${p.id}:${topic.id}`),
    );

    for (const p of pending) {
      if (!confirmed.has(p.id)) confirmed.set(p.id, topic);
    }
    if (pending.length) {
      console.log(`[generate] topic curation: ${topic.id}: reusing ${pending.length} stored needs-note verdict(s)`);
    }
    if (!fresh.length) continue;

    // Sightings first (needs_note=null): a crash mid-evaluation leaves them
    // to be re-evaluated next run rather than lost (getMisinfoSightingKeys
    // excludes null verdicts).
    await supabaseLogger.upsertMisinfoSightings(
      fresh.map((p) => ({
        tweet_id: p.id,
        topic_id: topic.id,
        feed_size: tierById.get(p.id) ?? "large",
        impression_count: p.public_metrics?.impression_count,
        author_name: p.author_name,
      })),
    );

    const selected = await selectPostsNeedingNote(topic, fresh);
    const reasonById = new Map(selected.map((s) => [s.postId, s.reason]));
    await supabaseLogger.recordMisinfoVerdicts(
      fresh.map((p) => ({
        tweet_id: p.id,
        topic_id: topic.id,
        needs_note: reasonById.has(p.id),
        selection_reason: reasonById.get(p.id),
      })),
    );
    console.log(`[generate] topic curation: ${topic.id}: ${fresh.length} new match(es), ${selected.length} need a note`);

    for (const p of fresh) {
      if (reasonById.has(p.id) && !confirmed.has(p.id)) confirmed.set(p.id, topic);
    }
  }
  return confirmed;
}

/**
 * Guarantee confirmed topic posts a bounded share of the run's processing
 * budget. Pure. Up to `slots` confirmed posts (fastest first, from the whole
 * new-post pool) are included; the rest of the budget keeps the regular
 * velocity-ranked selection, displacing its slowest picks when full. The
 * returned list is velocity-sorted descending (unknown last), matching the
 * regular selection's ordering.
 */
export function fillWithTopicPriority<T extends { post: Post }>(
  selected: T[],
  confirmedIds: Set<string>,
  pool: T[],
  maxPosts: number,
  slots: number = TOPIC_PRIORITY_SLOTS,
): { final: T[]; prioritized: T[]; displacedCount: number } {
  const byVelocityDesc = (a: T, b: T) =>
    (velocityPerHour(b.post) ?? -Infinity) - (velocityPerHour(a.post) ?? -Infinity);

  if (slots <= 0 || !confirmedIds.size) return { final: selected, prioritized: [], displacedCount: 0 };

  const prioritized = pool
    .filter((s) => confirmedIds.has(s.post.id))
    .sort(byVelocityDesc)
    .slice(0, slots);
  if (!prioritized.length) return { final: selected, prioritized: [], displacedCount: 0 };

  const prioritizedIds = new Set(prioritized.map((s) => s.post.id));
  const regulars = selected.filter((s) => !prioritizedIds.has(s.post.id));
  const keepRegulars = regulars.slice(0, Math.max(0, maxPosts - prioritized.length));

  const final = [...prioritized, ...keepRegulars].sort(byVelocityDesc);
  return {
    final,
    prioritized,
    displacedCount: regulars.length - keepRegulars.length,
  };
}
