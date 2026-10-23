import type { TablesInsert } from "./database.types";
import { fetchAllRows } from "./paging";
import { supabase } from "./supabase";
import type { FeedProjectRow, ProjectHeader } from "./types";

/* A project is how the public site groups notes, usually one creator: a row
 * of everything_projects. */

/** The two orders of the website's projects overview. */
export type ProjectOrder = "votes" | "name";

/** How many projects one page of the overview holds. */
export const PROJECTS_PAGE_SIZE = 30;

/** One page of the website's projects overview, starting after the project
 *  `after` (migration 139). A project with no visible note is left out. Since
 *  GOO-107 that matters: pressing "check this author's new posts" creates the
 *  creator's project immediately, and until the pipeline has checked
 *  something there is nothing to show under it. The anon key can create such a
 *  row, so the site must not put whatever it names on the public page. The
 *  "votes" order puts the highest score of the votes on a project's notes
 *  first and breaks ties by name. The scores come from a database function,
 *  because the anon key cannot read the votes table. */
export async function fetchProjectsPage(order: ProjectOrder, after: FeedProjectRow | null): Promise<FeedProjectRow[]> {
  const { data, error } = await supabase.rpc("everything_projects_page", {
    p_order: order,
    p_after_score: after?.vote_score,
    p_after_name: after?.name,
    p_after_id: after?.id,
    p_limit: PROJECTS_PAGE_SIZE,
  });
  if (error) throw error;
  return data;
}

/** The project with this slug, or null when there is none. */
export async function fetchProjectBySlug(slug: string): Promise<ProjectHeader | null> {
  const { data, error } = await supabase.from("everything_projects").select("id, slug, name, feed_url, avatar_url").eq("slug", slug).maybeSingle();
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
  const now = new Date().toISOString();
  try {
    const projects = await fetchAllRows<{ id: string; feed_url: string }>(
      () => supabase.from("everything_projects").select("id, feed_url").not("feed_url", "is", null).gt("priority_until", now),
      "id",
      { label: "prioritizedCreators" },
    );
    return projects.map((r) => r.feed_url);
  } catch {
    return null;
  }
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
