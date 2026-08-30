/**
 * Curated topic matching on the regular feed pool.
 *
 * The XXL pre-pass in generateMisinfoCandidates finds topic posts by crawling
 * the big feeds. Topic posts also arrive through the regular pass's own pool.
 * Without this module the regular pass treats them as generic posts, with no
 * reference document, no topic tag, and no sighting attributed to the topic.
 * This module runs the same two stages the pre-pass runs. Stage one is the
 * keyword match and stage two is the judgment of the selection LLM. A post the
 * LLM confirms then gets the full monitoring treatment: the topic's reference
 * document is injected, the eval gate becomes advisory, and the run records the
 * topic picks. Processing volume does not grow, because confirmed posts are
 * guaranteed a bounded number of slots inside the run's existing maxPosts
 * budget.
 *
 * This module and the pre-pass share one sightings ledger and one rule: a tweet
 * and topic pair is judged only once. A pair already judged as not needing a
 * note, or already processed, is left alone. A pair judged as needing a note but
 * never processed reuses the stored verdict here, so there is no second LLM
 * call. That case arises when the pre-pass selected the post and then dropped it
 * at its cap or at its velocity floor. Such a rescue still has to clear the
 * floor. fillWithTopicPriority applies the same topic velocity floor the
 * pre-pass work list applies, so a post dropped for being too slow cannot come
 * back through this route until a later fetch shows it moving faster than the
 * floor.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import type { FeedSize } from "../orchestration/utils/feedSizeStrategy";
import { matchPostsByTopic } from "./keywordFilter";
import { selectPostsNeedingNote } from "./selectPostsNeedingNote";
import { MISINFO_TOPICS, type MisinfoTopic } from "./topics";
import type { MisinfoTopicId } from "./topicIds";
import { isAboveFloor, MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR } from "../utils/velocity";

/** Confirmed topic matches are guaranteed up to this many of the run's maxPosts
 *  slots, fastest first. They displace the lowest-ranked regular picks, so the
 *  total number of posts processed does not change. Set this to 0 to keep the
 *  matching and the topic tagging but stop giving topic posts priority.
 *
 *  Set to 0 on 2026-08-18: topic posts now compete on velocity like everything
 *  else. The tagging and reference-document injection still run for any topic
 *  post that earns a slot on its own, so the concede-shape test keeps
 *  sampling. */
export const TOPIC_PRIORITY_SLOTS = 0;

/** The same shape as SourcedPost in generateCandidates. It is declared again
 *  here instead of imported, because generateCandidates imports this module.
 *  The velocity is the value frozen when the post was fetched. */
export interface PooledPost {
  post: Post;
  feedSize: FeedSize;
  velocity: number | null;
}

/**
 * Match the regular pool against the active topics. Returns the posts that a
 * selection verdict confirms as needing a note, keyed by tweet id. A post that
 * matches several topics is confirmed under the first one in MISINFO_TOPICS
 * order. The pre-pass work list uses that same rule.
 *
 * Callers must catch whatever this throws. selectPostsNeedingNote throws when
 * the model output cannot be recovered, which is deliberate, because it leaves
 * the sightings unjudged and they are retried next run. A failure in curation
 * must never take down the regular pass.
 *
 * This costs one extra read of the whole sightings ledger per run, because the
 * pre-pass reads it too. That is fine at the current table size. Passing the set
 * down from runPipeline is the optimization to make when it stops being fine.
 */
export async function curateRegularFeedPosts(opts: {
  /** This is every new post the ladder surfaced this run, including the posts
   *  below the floor. */
  fresh: PooledPost[];
  supabaseLogger: SupabaseLogger;
  topicIds: readonly MisinfoTopicId[];
}): Promise<Map<string, MisinfoTopic>> {
  const { fresh: pool, supabaseLogger } = opts;
  const confirmed = new Map<string, MisinfoTopic>();
  const topics = MISINFO_TOPICS.filter((t) => opts.topicIds.includes(t.id));
  if (!topics.length || !pool.length) return confirmed;

  const matched = matchPostsByTopic(pool.map((s) => s.post));
  if (![...matched.values()].some((posts) => posts.length)) return confirmed;
  const tierById = new Map(pool.map((s) => [s.post.id, s.feedSize]));

  const [judgedKeys, pendingKeys] = await Promise.all([
    supabaseLogger.getMisinfoSightingKeys(),
    supabaseLogger.getPendingMisinfoSightings(topics.map((t) => t.id)),
  ]);

  // The pre-pass dedupes its work list, so a post matching several topics is
  // judged once, under its first matching topic. Curation does not dedupe. It
  // judges such a post under every topic it matches. The confirmed map below
  // still keeps only the first topic. So the sighting for a second topic can
  // stay marked as needing a note and never be processed. Such a row is
  // returned by getPendingMisinfoSightings and does nothing. Only one topic is
  // active, so this cannot happen today. Copy the pre-pass dedupe here if a
  // second topic is ever turned on.
  for (const topic of topics) {
    const topicPosts = matched.get(topic.id) ?? [];
    if (!topicPosts.length) continue;

    // Reuse the stored verdicts and pay for a judgment only on genuinely new
    // pairs. A pair already judged as not needing a note, or already processed,
    // is left out of both lists.
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

    // Record the sightings before judging them, so they start with no verdict.
    // If the run crashes during evaluation they are evaluated again next run
    // instead of being lost, because getMisinfoSightingKeys ignores rows that
    // carry no verdict.
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
    console.log(`[generate] topic curation: ${topic.id}: ${fresh.length} new match(es), ${selected.length} need a note`);

    // Confirm the posts before writing the verdicts, and let the write fail
    // without stopping the run. Once the judge has spoken, a bookkeeping failure
    // must not cost the post its topic treatment in this run. The post would
    // then be processed as a generic post and recorded in the tweets ledger,
    // which the rescue of pending sightings cannot reach. If the write fails the
    // sightings keep no verdict and are judged again next run. The worst case is
    // one duplicate judge call. The treatment is never lost.
    for (const p of fresh) {
      if (reasonById.has(p.id) && !confirmed.has(p.id)) confirmed.set(p.id, topic);
    }
    try {
      await supabaseLogger.recordMisinfoVerdicts(
        fresh.map((p) => ({
          tweet_id: p.id,
          topic_id: topic.id,
          needs_note: reasonById.has(p.id),
          selection_reason: reasonById.get(p.id),
        })),
      );
    } catch (err) {
      console.warn(`[generate] topic curation: verdict write failed for ${topic.id} (treatment unaffected):`, err);
    }
  }
  return confirmed;
}

/**
 * Give confirmed topic posts a bounded share of the run's processing budget.
 * This function has no side effects. It takes up to `slots` confirmed posts,
 * fastest first, out of the whole pool of new posts. The rest of the budget goes
 * to the regular selection, and when the budget is full the regular picks that
 * rank lowest are dropped. The returned list puts the prioritized topic posts
 * first and then the kept regular posts in the order they came in, which is the
 * selection ranking. That list is the processing and submission order, so it is
 * never sorted again.
 *
 * Confirmed posts below the topic velocity floor are never prioritized. They are
 * returned in `floorDropped` so the caller can log them. The pre-pass work list
 * applies the same floor, so the two discovery routes can never disagree about
 * the same tweet. Their sightings stay pending, and such a post is offered again
 * once a later fetch shows it above the floor.
 */
export function fillWithTopicPriority<T extends { post: Post; velocity: number | null }>(
  selected: T[],
  confirmedIds: Set<string>,
  pool: T[],
  maxPosts: number,
  slots: number = TOPIC_PRIORITY_SLOTS,
): { final: T[]; prioritized: T[]; displacedCount: number; floorDropped: T[] } {
  // Rank by the velocity frozen at fetch time. Selection ranked on that same
  // value.
  const byVelocityDesc = (a: T, b: T) => (b.velocity ?? -Infinity) - (a.velocity ?? -Infinity);

  if (slots <= 0 || !confirmedIds.size) {
    return { final: selected, prioritized: [], displacedCount: 0, floorDropped: [] };
  }

  // Apply the topic floor to the velocity frozen at fetch time. Do not derive it
  // again here. SourcedPost in generateCandidates explains why: recomputing a
  // velocity part-way through a run makes it shrink.
  const confirmedPool = pool.filter((s) => confirmedIds.has(s.post.id));
  const aboveFloor = confirmedPool.filter((s) =>
    isAboveFloor(s.velocity, MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR),
  );
  const floorDropped = confirmedPool.filter((s) => !aboveFloor.includes(s));

  // Never take more slots than the run budget allows. When the writing limit is
  // nearly used up, computeMaxPosts really does return a maxPosts of 1 or 2,
  // which is below the slot count.
  const prioritized = aboveFloor.sort(byVelocityDesc).slice(0, Math.min(slots, maxPosts));
  if (!prioritized.length) return { final: selected, prioritized: [], displacedCount: 0, floorDropped };

  const prioritizedIds = new Set(prioritized.map((s) => s.post.id));
  const regulars = selected.filter((s) => !prioritizedIds.has(s.post.id));
  const keepRegulars = regulars.slice(0, Math.max(0, maxPosts - prioritized.length));

  const final = [...prioritized, ...keepRegulars];
  return {
    final,
    prioritized,
    displacedCount: regulars.length - keepRegulars.length,
    floorDropped,
  };
}
