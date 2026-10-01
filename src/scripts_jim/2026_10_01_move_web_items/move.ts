/**
 * Moves pages that belong to a creator out of the catch-all "Around the web"
 * project and into that creator's project (GOO-290). Until GOO-290 the request
 * consumer filed every requested page under "Around the web". A creator who has
 * no project yet gets one, the same way a new request now creates it.
 *
 * The creator is found the way each source allows:
 *   - a *.substack.com page names its publication in its address,
 *   - a YouTube video's channel handle comes from the Data API (2 quota units),
 *   - a LessWrong or Alignment Forum post's author comes from the forum's API,
 *   - a Substack reader link (substack.com/home/post/p-…) is first resolved to
 *     the publication's own post address, the way the extension does it,
 *   - any other post-shaped page (a /p/ path) is fetched once, and a Substack
 *     page on a custom domain names its *.substack.com form inside the page.
 * A page none of these resolves stays where it is. That includes the bare
 * substack.com home page, Substack profiles and Substack Notes, which are not
 * posts of a publication.
 *
 * Prints what it would do. With --apply it also moves the items.
 *
 * Usage:
 *   bun run src/scripts_jim/2026_10_01_move_web_items/move.ts [--apply]
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { extractYoutubeVideoId, fetchReaderCanonical, isSubstackReaderUrl } from "../../everything-core/pageUrls";
import { WEB_PROJECT_SLUG } from "../../everything-core/projects";
import { resolveProjectId } from "../../everything/db";
import { canonicalLesswrongFeed, canonicalSubstackFeed, canonicalYoutubeFeed, substackFeedOfPage, type CanonicalFeed } from "../../everything/feedUrls";
import { parsePostUrl } from "../../everything/sources/lesswrong";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const apply = process.argv.includes("--apply");

async function youtubeGet(resource: string, params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams({ ...params, key: process.env.YOUTUBE_DATA_V3_API_KEY! });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${query}`);
  if (!res.ok) throw new Error(`YouTube ${resource}: ${res.status}`);
  return res.json();
}

async function youtubeCreator(videoId: string): Promise<CanonicalFeed | null> {
  const channelId = (await youtubeGet("videos", { part: "snippet", id: videoId })).items?.[0]?.snippet?.channelId;
  if (!channelId) return null;
  const handle = (await youtubeGet("channels", { part: "snippet", id: channelId })).items?.[0]?.snippet?.customUrl;
  return canonicalYoutubeFeed(`https://www.youtube.com/${handle ?? `channel/${channelId}`}`);
}

async function forumCreator(origin: string, postId: string): Promise<CanonicalFeed | null> {
  const res = await fetch(`${origin}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "common-notes-pipeline" },
    body: JSON.stringify({ query: `{ post(input: {selector: {_id: "${postId}"}}) { result { user { slug } } } }` }),
  });
  const slug = (await res.json()).data?.post?.result?.user?.slug;
  return slug ? canonicalLesswrongFeed(`${origin}/users/${slug}`) : null;
}

const PAGE_FETCH_TIMEOUT_MS = 20_000;

/** A Substack page embeds its publication data, subdomain included, the same
 *  blob the extension and the prioritize script read. */
async function substackCreatorFromPage(url: string): Promise<CanonicalFeed | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const subdomain = (await res.text()).match(/subdomain\\?":\\?"([\w-]+)\\?"/)?.[1];
  return subdomain ? canonicalSubstackFeed(`https://${subdomain.toLowerCase()}.substack.com`) : null;
}

/** A forum post sits under /posts/<id>, or under /s/<sequence>/p/<id> when it
 *  is read inside a sequence. parsePostUrl knows only the first shape. */
function forumPostOf(url: string): { origin: string; postId: string } | null {
  const inSequence = url.match(/^(https:\/\/www\.(?:lesswrong\.com|alignmentforum\.org))\/s\/\w+\/p\/(\w+)/);
  return inSequence ? { origin: inSequence[1]!, postId: inSequence[2]! } : parsePostUrl(url);
}

async function creatorOfPage(url: string): Promise<CanonicalFeed | null> {
  const byAddress = substackFeedOfPage(url);
  if (byAddress) return byAddress;
  const videoId = extractYoutubeVideoId(url);
  if (videoId) return youtubeCreator(videoId);
  const forumPost = forumPostOf(url);
  if (forumPost) return forumCreator(forumPost.origin, forumPost.postId);
  if (isSubstackReaderUrl(url)) {
    const publicationUrl = await fetchReaderCanonical(url);
    return publicationUrl ? creatorOfPage(publicationUrl) : null;
  }
  if (!new URL(url).pathname.startsWith("/p/")) return null;
  return substackCreatorFromPage(url);
}

const { data: web } = await db.from("everything_projects").select("id").eq("slug", WEB_PROJECT_SLUG).single();
const { data: items, error } = await db.from("everything_items").select("id, url").eq("project_id", web!.id).order("created_at");
if (error) throw error;

let moved = 0;
for (const item of items!) {
  const creator = await creatorOfPage(item.url);
  if (!creator) {
    console.log(`stays        ${item.url}`);
    continue;
  }
  console.log(`-> ${creator.feed_url.padEnd(50)} ${item.url}`);
  if (!apply) continue;
  const projectId = await resolveProjectId({ slug: creator.project_slug, feedUrl: creator.feed_url });
  const { error: moveError } = await db.from("everything_items").update({ project_id: projectId }).eq("id", item.id);
  if (moveError) throw moveError;
  moved++;
}
console.log(apply ? `\nmoved ${moved} of ${items!.length} items` : `\ndry run over ${items!.length} items; pass --apply to move them`);
