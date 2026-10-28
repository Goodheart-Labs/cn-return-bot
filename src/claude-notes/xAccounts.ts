/* The X accounts of the creators (GOO-639, migration 154). The runner on
 * Nathan's ai-box starts a Claude for every creator that has a posted Claude
 * note and whose X account nobody has looked up yet. That Claude searches the
 * web, asks Grok, which can search X itself, and saves what it found with
 * `bun run claude-notes x-handle`. The posting tool then names the creator by
 * that handle in the tweet. The first run of the runner after this shipped
 * looks up the creators of every Claude note written so far. */

import { fetchAllRows, fetchInBatches } from "../everything-core/paging";
import { db } from "./store";

/** How many of a creator's posts the Claude gets as a starting point. */
const POSTS_PER_CREATOR = 3;

export interface CreatorToLookUp {
  slug: string;
  name: string;
  feedUrl: string | null;
  postUrls: string[];
}

/** The creators with a posted Claude note whose X account nobody looked up
 *  yet, each with a few of the posts Claude wrote notes on. */
export async function creatorsToLookUp(): Promise<CreatorToLookUp[]> {
  const drafts = await fetchAllRows<{ id: string; everything_items: { url: string; project_id: string | null } | null }>(
    () => db().from("everything_claude_drafts").select("id, everything_items(url, project_id)").eq("status", "posted"),
    "id",
    { label: "posted Claude drafts" },
  );
  const postsByProject = new Map<string, Set<string>>();
  for (const { everything_items: item } of drafts) {
    if (item?.project_id) postsByProject.set(item.project_id, (postsByProject.get(item.project_id) ?? new Set()).add(item.url));
  }
  const projects = await fetchInBatches<{ id: string; slug: string; name: string; feed_url: string | null }>(
    (ids) => db().from("everything_projects").select("id, slug, name, feed_url").in("id", ids).is("x_handle_status", null),
    [...postsByProject.keys()],
    "id",
    { label: "creators without an X account" },
  );
  return projects.map((p) => ({ slug: p.slug, name: p.name, feedUrl: p.feed_url, postUrls: [...postsByProject.get(p.id)!].slice(0, POSTS_PER_CREATOR) }));
}

/** Records a creator's X handle, or with null that they have no X account. */
export async function saveXHandle(slug: string, handle: string | null, evidence: string) {
  // The database reads a missing handle as "no X account".
  const { error } = await db().rpc("everything_set_x_handle", { p_project_slug: slug, p_handle: handle as string, p_evidence: evidence, p_actor: "claude" });
  if (error) throw new Error(error.message);
}
