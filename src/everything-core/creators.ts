import type { TablesInsert } from "./database.types";
import { supabase } from "./supabase";
import type { FeedProjectRow } from "./types";

/* A project is how the public site groups notes, usually one creator: a row
 * of everything_projects. */

/** The projects the website lists, the most voted first and ties by name. A
 *  project with no content is left out, and since GOO-107 that matters:
 *  pressing "check this author's new posts" creates the creator's project
 *  immediately, and until the pipeline has actually checked something there is
 *  nothing to show under it. The anon key can create such a row, so the site
 *  must not put whatever it names on the public page. Both the filter and the
 *  vote scores come from one database function (migration 094), because the
 *  anon key cannot read the votes table. */
export async function fetchProjects(): Promise<FeedProjectRow[]> {
  const { data, error } = await supabase.rpc("everything_projects_by_votes");
  if (error) throw error;
  return data;
}

/** Returns the feed URL of every creator whose priority window is open right
 *  now. The extension caches it next to the coverage list, and the button
 *  surfaces read it to say "we're already checking this author" instead of
 *  offering the press again.
 *
 *  The window has to be filtered here. Anon can read every project row, because
 *  the public site lists them, so without the comparison this would return every
 *  creator we have ever known and the button would never be offered again once
 *  someone had pressed it. Returns null when the query failed, so a caller does
 *  not mistake an outage for "nobody is prioritised". */
export async function fetchPrioritizedCreatorUrls(): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("everything_projects")
    .select("feed_url")
    .not("feed_url", "is", null)
    .gt("priority_until", new Date().toISOString());
  if (error) return null;
  return data.map((r) => r.feed_url!);
}

/** Records that a reader wants a whole Substack publication or YouTube channel
 *  fact-checked for the next week. This writes straight into the creator's
 *  project row: the database decides the window, because the key this runs with
 *  is public. See migration 086. Anonymous presses are allowed.
 *
 *  Pressing a creator we already know updates their row instead of inserting,
 *  which the database's own trigger does. That path deliberately affects no
 *  rows, so an empty result is success and not failure. */
export async function requestCreatorPriority(params: { feedUrl: string }) {
  // The generated insert type asks for the slug and the name as well. For
  // this insert a database trigger fills them in from the feed URL.
  const row = { feed_url: params.feedUrl } as TablesInsert<"everything_projects">;
  const { error } = await supabase.from("everything_projects").insert(row);
  if (error) throw new Error(error.message);
}
