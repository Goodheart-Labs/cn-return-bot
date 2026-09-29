/**
 * Creator pictures for the website's projects overview (migration 106). Each
 * source already has an endpoint the pipeline uses, and each carries the
 * picture: the YouTube channel lookup (one API unit), the Substack RSS feed's
 * channel image, and the LessWrong or Alignment Forum user query.
 *
 * Every feed run refreshes a few projects whose last attempt is missing or
 * older than a month, so pictures stay current without a separate schedule.
 * `bun run everything-refresh-avatars` refreshes every due project at once.
 */

import "dotenv/config";
import { fetchProjectsDueForAvatar, recordAvatarAttempt, type AvatarDue } from "./db";
import { canonicalFeed } from "./feedUrls";
import { fetchAuthorProfileImage } from "./sources/lesswrong";
import { fetchFeedPosts } from "./sources/substack";
import { resolveChannel } from "./sources/youtubeDataApi";

/** How long a fetched picture is trusted before the next attempt. */
const REFRESH_AFTER_DAYS = 30;
/** How soon a failed attempt is tried again. */
const RETRY_AFTER_FAILURE_DAYS = 1;
const DAY_MS = 24 * 3600 * 1000;

/** How many pictures one feed run refreshes. The first runs after the
 *  migration catch up on every project this many at a time. */
export const AVATARS_PER_RUN = 5;

/** The creator's current picture, or null when the source has none. */
export async function fetchAvatarUrl(feedUrl: string): Promise<string | null> {
  const feed = canonicalFeed(feedUrl);
  if (!feed) throw new Error(`Not a feed URL we know: ${feedUrl}`);
  if (feed.feed_type === "youtube") return (await resolveChannel(feed.feed_url)).thumbnailUrl ?? null;
  if (feed.feed_type === "substack") return (await fetchFeedPosts(feed.feed_url)).imageUrl ?? null;
  return fetchAuthorProfileImage(feed.feed_url);
}

async function refreshOne(project: AvatarDue): Promise<void> {
  try {
    await recordAvatarAttempt(project.id, await fetchAvatarUrl(project.feed_url), new Date());
  } catch (err) {
    // One creator's feed failing must not stop the run, the same way the walk
    // skips a feed that will not list. The attempt is back-dated so that it
    // falls due again in a day: a passing failure such as an exhausted YouTube
    // quota then heals tomorrow, and a lasting one costs one call a day
    // instead of blocking the creators queued behind it every run.
    console.log(`  picture of ${project.slug}: ${err instanceof Error ? err.message : String(err)}`);
    await recordAvatarAttempt(project.id, null, new Date(Date.now() - (REFRESH_AFTER_DAYS - RETRY_AFTER_FAILURE_DAYS) * DAY_MS));
  }
}

/** Refreshes the pictures of up to `limit` due projects. Returns how many it
 *  tried. */
export async function refreshStaleAvatars(limit: number): Promise<number> {
  const due = await fetchProjectsDueForAvatar(new Date(Date.now() - REFRESH_AFTER_DAYS * DAY_MS), limit);
  for (const project of due) await refreshOne(project);
  if (due.length) console.log(`Refreshed ${due.length} creator pictures (up to ${limit} per run)`);
  return due.length;
}

if (import.meta.main) {
  const MAX_PROJECTS = 10_000;
  await refreshStaleAvatars(MAX_PROJECTS);
}
