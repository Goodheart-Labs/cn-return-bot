import type { Post } from "../../api/fetchEligiblePosts";
import { velocityPerHour } from "../utils/velocity";

export interface RankFeatures {
  hasMedia: boolean;
  authorFollowers: number | null;
  velocityPerHour: number | null;
  ageHoursAtFetch: number | null;
  tierRank: number | null;
}

export const FLAG_FOLLOWER_CEILING = 1_000_000;
export const FLAG_VELOCITY_FLOOR_PER_HOUR = 15_000;
export const FLAG_AGE_MIN_HOURS = 3;
export const FLAG_AGE_MAX_HOURS = 12;

export function featuresFromPost(
  post: Post,
  velocity: number | null | undefined,
  tierRank: number | null,
  asOfMs: number = Date.now(),
): RankFeatures {
  const createdMs = post.created_at ? new Date(post.created_at).getTime() : NaN;
  return {
    hasMedia: Array.isArray(post.media) && post.media.length > 0,
    authorFollowers: post.author_followers ?? null,
    velocityPerHour: velocity ?? velocityPerHour(post, asOfMs),
    ageHoursAtFetch: Number.isFinite(createdMs) ? (asOfMs - createdMs) / 3_600_000 : null,
    tierRank,
  };
}

export interface TweetRow {
  posted_at: string | null;
  first_seen_at: string | null;
  impressions: number | null;
  author_followers: number | null;
  has_video: boolean | null;
  has_photo: boolean | null;
}

export function featuresFromTweetRow(row: TweetRow): RankFeatures {
  const postedMs = row.posted_at ? new Date(row.posted_at).getTime() : NaN;
  const seenMs = row.first_seen_at ? new Date(row.first_seen_at).getTime() : NaN;
  const ok = Number.isFinite(postedMs) && Number.isFinite(seenMs);
  const fake = { public_metrics: { impression_count: row.impressions ?? undefined }, created_at: row.posted_at ?? "" } as unknown as Post;
  return {
    hasMedia: !!(row.has_video || row.has_photo),
    authorFollowers: row.author_followers,
    velocityPerHour: ok ? velocityPerHour(fake, seenMs) : null,
    ageHoursAtFetch: ok ? (seenMs - postedMs) / 3_600_000 : null,
    tierRank: null,
  };
}

export interface Flags {
  media: boolean;
  smallAuthor: boolean;
  fast: boolean;
  freshWindow: boolean;
}

// Unknown values count as passing, matching the fail-open velocity floor.
export function flagsOf(f: RankFeatures): Flags {
  return {
    media: f.hasMedia,
    smallAuthor: f.authorFollowers === null || f.authorFollowers < FLAG_FOLLOWER_CEILING,
    fast: f.velocityPerHour === null || f.velocityPerHour >= FLAG_VELOCITY_FLOOR_PER_HOUR,
    freshWindow:
      f.ageHoursAtFetch === null ||
      (f.ageHoursAtFetch >= FLAG_AGE_MIN_HOURS && f.ageHoursAtFetch < FLAG_AGE_MAX_HOURS),
  };
}

export function flagCount(f: RankFeatures): number {
  const fl = flagsOf(f);
  return Number(fl.media) + Number(fl.smallAuthor) + Number(fl.fast) + Number(fl.freshWindow);
}
