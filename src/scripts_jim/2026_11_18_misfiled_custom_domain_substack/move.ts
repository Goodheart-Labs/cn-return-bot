/** GOO-774: from about 2026-10-16 to 2026-11-18 the extension could not name
 *  the creator of a Substack newsletter on its own domain. Pages readers
 *  requested there, or wrote the first note on, went under "Around the web".
 *  This script finds every post of the web project on a host other than
 *  *.substack.com, reads the page, and moves each Substack post to its
 *  creator's project, the same project intake would have picked
 *  (resolveProjectId creates a missing one without priority).
 *
 *  Dry run by default. `--write` makes the moves.
 *
 *    bun run src/scripts_jim/2026_11_18_misfiled_custom_domain_substack/move.ts [--write]
 */
import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";
import { resolveProjectId } from "../../everything/db";
import { substackFeedInPageHtml } from "../../everything/feedUrls";

const WEB_PROJECT_SLUG = "web";
const CUSTOM_DOMAIN_POST_PATTERN = "^https?://[^/]+/p/";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const write = process.argv.includes("--write");
const db = getSupabaseClient();

const { data: web, error: webError } = await db.from("everything_projects").select("id").eq("slug", WEB_PROJECT_SLUG).single();
if (webError) throw webError;

// Well under the 1,000-row cap: the web project has about 300 such posts.
const { data: items, error } = await db
  .from("everything_items")
  .select("id, url")
  .eq("project_id", web.id)
  .filter("url", "match", CUSTOM_DOMAIN_POST_PATTERN)
  .not("url", "like", "%.substack.com/%");
if (error) throw error;
console.log(`${items.length} posts of the web project on a host other than *.substack.com`);

for (const item of items) {
  const res = await fetch(item.url, { headers: { "User-Agent": BROWSER_USER_AGENT } });
  if (!res.ok) throw new Error(`${item.url} answered ${res.status}`);
  const html = await res.text();
  const feed = html.includes("window._preloads") ? substackFeedInPageHtml(html) : null;
  if (!feed) {
    console.log(`not Substack, stays: ${item.url}`);
    continue;
  }
  if (!write) {
    console.log(`would move to ${feed.feed_url}: ${item.url}`);
    continue;
  }
  const projectId = await resolveProjectId({ slug: feed.project_slug, feedUrl: feed.feed_url });
  const { error: moveError } = await db.from("everything_items").update({ project_id: projectId }).eq("id", item.id);
  if (moveError) throw moveError;
  console.log(`moved to ${feed.feed_url}: ${item.url}`);
}
