/**
 * The posts the first account leaves to the WSDM Cup account (GOO-880). Jim
 * does not want the first account to take posts away from the competition
 * writer. The competition writer hands a post to Claude when the post is in
 * its feed and its predicted views still to come clear its threshold
 * (src/x-watch/pick.ts). cn-x-watch stores that threshold after every walk
 * of its feed, and its readings are in x_watch_feed_views.
 *
 * Its feed is the contest's, not the small feed. On 2026-11-25, 109 of the
 * 822 posts of its walk were in the first account's walk, 18 of them in the
 * small tier, 39 in large and 52 only in XL. So the rule looks at the
 * competition writer's own feed, whatever the tier.
 */

import { getSupabaseClient } from "../api/supabaseClient";
import type { XAccount } from "../api/xAccount";
import { fetchAllRows } from "../everything-core/paging";

const COMPETITION_ACCOUNT: XAccount = "wsdm";

/** The competition writer's newest walk: each post's score in it, and its
 *  threshold. A null threshold means it has none yet. */
export type CompetitionFeed = { threshold: number | null; scores: Map<string, number | null> };

export async function readCompetitionFeed(): Promise<CompetitionFeed> {
  const db = getSupabaseClient();
  const { data: state, error: stateError } = await db.from("pipeline_state").select("value").eq("key", `${COMPETITION_ACCOUNT}:views_threshold`).maybeSingle();
  if (stateError) throw new Error(`Could not read the competition writer's threshold: ${stateError.message}`);
  const { data: walk, error: walkError } = await db
    .from("x_watch_feed_views")
    .select("walked_at")
    .eq("x_account", COMPETITION_ACCOUNT)
    .order("walked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (walkError) throw new Error(`Could not find the competition writer's newest walk: ${walkError.message}`);
  if (!walk) return { threshold: null, scores: new Map() };
  // tweet_id is a bigint, which JSON would round, so it is read as text.
  const rows = await fetchAllRows<{ tweet_id: string; views_to_come: number | null }>(
    () => db.from("x_watch_feed_views").select("tweet_id::text, views_to_come").eq("x_account", COMPETITION_ACCOUNT).eq("walked_at", walk.walked_at),
    "tweet_id",
    { label: "competitionFeed" },
  );
  return { threshold: state ? (JSON.parse(state.value) as number | null) : null, scores: new Map(rows.map((r) => [r.tweet_id, r.views_to_come])) };
}
