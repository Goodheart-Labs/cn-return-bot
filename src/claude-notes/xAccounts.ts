/* The X accounts of the creators (GOO-639, migration 154). The runner on
 * Nathan's ai-box, or the dispatcher on the devbox while the ai-box is down,
 * starts a Claude for every creator that has a posted Claude note and whose X
 * account nobody has looked up yet. That Claude searches the
 * web, asks Grok, which can search X itself, and saves what it found with
 * `bun run claude-notes x-handle`. The posting tool then names the creator by
 * that handle in the tweet. The first run of the runner after this shipped
 * looks up the creators of every Claude note written so far. */

import { fetchAllRows, fetchInBatches } from "../everything-core/paging";
import { WEB_PROJECT_SLUG } from "../everything-core/projects";
import { db } from "../serviceDb";

export interface CreatorToLookUp {
  slug: string;
  name: string;
  feedUrl: string | null;
}

/** The creators with a posted Claude note whose X account nobody looked up
 *  yet. The project "web"
 *  collects one-off pages and has no single creator, so it is left out. */
export async function creatorsToLookUp(): Promise<CreatorToLookUp[]> {
  const drafts = await fetchAllRows<{ id: string; everything_items: { project_id: string | null } | null }>(
    () => db().from("everything_claude_drafts").select("id, everything_items(project_id)").eq("status", "posted"),
    "id",
    { label: "posted Claude drafts" },
  );
  const projectIds = new Set(drafts.flatMap(({ everything_items: item }) => (item?.project_id ? [item.project_id] : [])));
  const projects = await fetchInBatches<{ id: string; slug: string; name: string; feed_url: string | null }>(
    (ids) => db().from("everything_projects").select("id, slug, name, feed_url").in("id", ids).is("x_handle_status", null).neq("slug", WEB_PROJECT_SLUG),
    [...projectIds],
    "id",
    { label: "creators without an X account" },
  );
  return projects.map((p) => ({ slug: p.slug, name: p.name, feedUrl: p.feed_url }));
}

/** Whether anyone has saved an answer for the creator, a handle or "none". */
export async function xHandleChecked(slug: string): Promise<boolean> {
  const { data, error } = await db().from("everything_projects").select("x_handle_status").eq("slug", slug).single();
  if (error) throw new Error(error.message);
  return data.x_handle_status !== null;
}

/** Records a creator's X handle, or with null that they have no X account. */
export async function saveXHandle(slug: string, handle: string | null, evidence: string) {
  // The database reads a missing handle as "no X account".
  const { error } = await db().rpc("everything_set_x_handle", { p_project_slug: slug, p_handle: handle as string, p_evidence: evidence, p_actor: "claude" });
  if (error) throw new Error(error.message);
}
