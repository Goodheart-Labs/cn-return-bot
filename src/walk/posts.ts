/* What cn-walk adds to the post list (GOO-791): every post a walked creator
 * published in the last 14 days that Common Notes does not have yet. A
 * Substack or forum post comes with the text of its listing, so it never has
 * to be read again. A video is added bare, and the intake service reads its
 * captions. A page that has an item only because a reader wrote a note on it,
 * or because one paragraph was checked, becomes a whole-page check. */

import type { StoredUpload } from "../everything/db";
import { enqueueItems, fetchItemUrlsContaining, fetchItemUrlsIn, promoteItemToWholePage, resolveProjectId } from "../everything/db";
import type { FeedPost } from "../everything/sources/substack";
import type { SourceKind } from "../everything/types";
import type { ForumPost } from "../pipeline/fetch/sites/forum";
import { htmlToText } from "../pipeline/utils/html";
import type { RankedCreator } from "../everything/creatorRanking";

/** Posts published longer ago than this are not added. In the 30 days to
 *  2026-11-12, posts 14 or more days old gave 2.2 Helpful notes per 100 posts,
 *  younger ones 17. The list uses the same window (everything_list_days in
 *  migration 184). */
export const MAX_POST_AGE_DAYS = 14;

const DAY_MS = 24 * 3600_000;

export interface FeedEntry {
  source: SourceKind;
  url: string;
  /** What existing item addresses are matched against: a video's id, a forum
   *  post's id, a Substack post's own address. Stored addresses vary. */
  matchKey: string;
  title: string;
  /** The body, when the listing carries it. */
  fullText?: string;
  /** The publication day, YYYY-MM-DD. */
  publishedAt: string;
  publishedTime?: string;
}

export const substackEntries = (posts: FeedPost[]): FeedEntry[] =>
  posts
    // A paid post's body is only the free preview. Nathan enqueues paid posts
    // by hand with their full text.
    .filter((p) => !p.paywalled)
    .map((p) => ({
      source: "substack",
      url: p.url,
      matchKey: p.url,
      title: p.title,
      fullText: htmlToText(p.bodyHtml),
      publishedAt: p.publishedAt.slice(0, 10),
      publishedTime: p.publishedAt,
    }));

export const forumEntries = (posts: ForumPost[]): FeedEntry[] =>
  posts.map((p) => ({
    source: "lesswrong",
    url: p.url,
    matchKey: p.postId,
    title: p.title,
    fullText: p.text,
    publishedAt: p.postedAt.slice(0, 10),
    publishedTime: p.postedAt,
  }));

export const youtubeEntries = (uploads: StoredUpload[]): FeedEntry[] =>
  uploads
    // A premiere that has not aired cannot be watched yet. A later listing
    // finds it once it has.
    .filter((v) => !v.upcoming)
    .map((v) => ({
      source: "youtube",
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      matchKey: v.videoId,
      title: v.title,
      publishedAt: v.publishedAt,
      publishedTime: v.publishedTime,
    }));

/** The entries published in the last MAX_POST_AGE_DAYS days. */
export function recentEntries(entries: FeedEntry[], now = new Date()): FeedEntry[] {
  const cutoff = new Date(now.getTime() - MAX_POST_AGE_DAYS * DAY_MS).toISOString().slice(0, 10);
  return entries.filter((e) => e.publishedAt >= cutoff);
}

/** Adds the creator's recent posts that are new, and returns how many it
 *  added. With `dryRun` it only says what it would add. */
export async function addNewPosts(creator: RankedCreator, sourceName: string | undefined, entries: FeedEntry[], dryRun: boolean): Promise<number> {
  const recent = recentEntries(entries);
  if (recent.length === 0) return 0;
  const known =
    creator.feed_type === "substack" ? await fetchItemUrlsIn(recent.map((e) => e.matchKey)) : await fetchItemUrlsContaining(recent.map((e) => e.matchKey));
  const existing = (entry: FeedEntry) => known.find((k) => k.url.includes(entry.matchKey)) ?? null;
  const fresh = recent.filter((e) => existing(e)?.checked_scope !== "page");
  if (fresh.length === 0) return 0;
  for (const entry of fresh) console.log(`[walk] ${dryRun ? "would add" : "adding"} [${creator.project_slug}] ${entry.publishedAt} ${entry.title} · ${entry.url}`);
  if (dryRun) return fresh.length;
  for (const entry of fresh) {
    const item = existing(entry);
    if (item) await promoteItemToWholePage(item.id, entry.fullText ?? null, { requested: false });
  }
  const added = fresh.filter((e) => !existing(e));
  if (added.length === 0) return fresh.length;
  const projectId = await resolveProjectId({ slug: creator.project_slug, displayName: sourceName, feedUrl: creator.feed_url });
  await enqueueItems(
    added.map((e) => ({
      project_id: projectId,
      source: e.source,
      url: e.url,
      title: e.title,
      full_text: e.fullText,
      published_at: e.publishedAt,
      published_time: e.publishedTime,
    })),
  );
  return fresh.length;
}
