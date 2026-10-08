/**
 * Creator pictures for the website's projects overview (migration 106). Each
 * source already has an endpoint the pipeline uses, and each carries the
 * picture: the YouTube channel lookup (one API unit), the Substack RSS feed's
 * channel image, and the LessWrong or Alignment Forum user query.
 *
 * The same answer carries the creator's name. A project created from a reader
 * request knows only its slug (GOO-290), so its name is filled in here, on
 * the first feed run after the project appeared.
 *
 * Every feed run refreshes a few projects whose last attempt is missing or
 * older than a month, so pictures stay current without a separate schedule.
 * `bun run everything-refresh-avatars` refreshes every due project at once.
 */

import "dotenv/config";
import { fetchProjectsDueForAvatar, fillProjectDisplayName, recordAvatarAttempt, type AvatarDue } from "./db";
import { canonicalFeed } from "./feedUrls";
import { fetchAuthorProfile } from "./sources/lesswrong";
import { fetchFeedPosts } from "./sources/substack";
import { resolveChannel } from "../pipeline/media/youtubeDataApi";

/** How long a fetched picture is trusted before the next attempt. */
const REFRESH_AFTER_DAYS = 30;
/** How soon a failed attempt is tried again. */
const RETRY_AFTER_FAILURE_DAYS = 1;
const DAY_MS = 24 * 3600 * 1000;

/** How many pictures one feed run refreshes. The first runs after the
 *  migration catch up on every project this many at a time. */
export const AVATARS_PER_RUN = 5;

/** The creator's current picture and name as their source shows them. The
 *  picture is null when the source has none. */
export async function fetchCreatorProfile(feedUrl: string): Promise<{ avatarUrl: string | null; name?: string }> {
  const feed = canonicalFeed(feedUrl);
  if (!feed) throw new Error(`Not a feed URL we know: ${feedUrl}`);
  if (feed.feed_type === "youtube") {
    const channel = await resolveChannel(feed.feed_url);
    return { avatarUrl: channel.thumbnailUrl ?? null, name: channel.title };
  }
  if (feed.feed_type === "substack") {
    const publication = await fetchFeedPosts(feed.feed_url);
    return { avatarUrl: publication.imageUrl ?? null, name: publication.title };
  }
  const author = await fetchAuthorProfile(feed.feed_url);
  return { avatarUrl: author.imageUrl, name: author.displayName };
}

async function refreshOne(project: AvatarDue): Promise<void> {
  try {
    const profile = await fetchCreatorProfile(project.feed_url);
    await recordAvatarAttempt(project.id, profile.avatarUrl, new Date());
    await fillProjectDisplayName(project.id, profile.name);
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
