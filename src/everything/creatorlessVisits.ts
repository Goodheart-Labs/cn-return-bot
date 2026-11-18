import { getSupabaseClient } from "../api/supabaseClient";

/** The extension names a custom-domain Substack's creator by reading the
 *  publication out of the page itself, so it breaks whenever Substack changes
 *  its page. From about 2026-10-16 to 2026-11-18 it named no creator on any
 *  such page and nothing went red (GOO-774). Those visits got no reader hash
 *  either, so they counted for nothing in the creator score and the reader
 *  demand queue, and that cannot be repaired afterwards. This check watches
 *  the visits themselves. Before the break about one such visit a day lacked
 *  its creator, out of 5 to 80. After it nearly all of them did. */
const WINDOW_HOURS = 24;
/** A quiet day has too few visits to judge. */
const MIN_VISITS_TO_JUDGE = 10;
const MAX_SHARE_WITHOUT_CREATOR = 0.5;

/** Why this run must go red because the extension stopped naming the creator
 *  of custom-domain Substack posts, or null when it still does. It counts the
 *  visits of the last day on posts of Substack items whose address is not on
 *  *.substack.com. */
export async function creatorlessSubstackVisitsProblem(): Promise<string | null> {
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
  const customDomainSubstackVisits = () =>
    getSupabaseClient()
      .from("everything_link_visits")
      .select("id, everything_items!inner(source)", { count: "exact", head: true })
      .eq("everything_items.source", "substack")
      .not("url", "like", "%.substack.com/%")
      .gte("visited_at", since);
  const [all, withoutCreator] = await Promise.all([customDomainSubstackVisits(), customDomainSubstackVisits().is("feed_url", null)]);
  if (all.error) throw all.error;
  if (withoutCreator.error) throw withoutCreator.error;
  const visits = all.count ?? 0;
  const creatorless = withoutCreator.count ?? 0;
  if (visits < MIN_VISITS_TO_JUDGE || creatorless <= visits * MAX_SHARE_WITHOUT_CREATOR) return null;
  return (
    `${creatorless} of ${visits} visits in the last ${WINDOW_HOURS} hours on Substack posts on their own domain have no creator. ` +
    "The extension probably cannot read the publication out of Substack's page any more (readSubstackPublicationFromPage, GOO-774)."
  );
}
