import type { Post } from "../../api/fetchEligiblePosts";
import { velocityPerHour } from "../utils/velocity";
import { VIEWS_TO_COME_FLOOR } from "../utils/viewsToCome";

export interface RankFeatures {
  hasMedia: boolean;
  authorFollowers: number | null;
  velocityPerHour: number | null;
  /** Predicted views still to come, frozen at fetch (viewsToCome.ts). Null
   *  when the run had no feed view recorder readings for the post. */
  viewsToCome: number | null;
  ageHoursAtFetch: number | null;
  tierRank: number | null;
}

export function featuresFromPost(
  post: Post,
  velocity: number | null | undefined,
  viewsToCome: number | null | undefined,
  tierRank: number | null,
  asOfMs: number = Date.now(),
): RankFeatures {
  const createdMs = post.created_at ? new Date(post.created_at).getTime() : NaN;
  return {
    // Photo or video only, matching tweets.has_photo/has_video, which the flag was fitted on.
    hasMedia: Array.isArray(post.media) && post.media.some((m) => m?.type === "photo" || m?.type === "video"),
    authorFollowers: post.author_followers ?? null,
    velocityPerHour: velocity ?? velocityPerHour(post, asOfMs),
    viewsToCome: viewsToCome ?? null,
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
    viewsToCome: null,
    ageHoursAtFetch: ok ? (seenMs - postedMs) / 3_600_000 : null,
    tierRank: null,
  };
}

export interface FlagCuts {
  followerCeiling: number;
  velocityFloorPerHour: number;
  ageMinHours: number;
  ageMaxHours: number;
  fittedOn: string;
}

export interface Flags {
  media: boolean;
  smallAuthor: boolean;
  fast: boolean;
  freshWindow: boolean;
}

// Unknown values count as passing, matching the fail-open velocity floor. A post
// with a prediction is fast when it clears the floor on predicted views still
// to come; one without falls back to the velocity cut.
export function flagsOf(f: RankFeatures, cuts: FlagCuts): Flags {
  return {
    media: f.hasMedia,
    smallAuthor: f.authorFollowers === null || f.authorFollowers < cuts.followerCeiling,
    fast: f.viewsToCome !== null
      ? f.viewsToCome >= VIEWS_TO_COME_FLOOR
      : f.velocityPerHour === null || f.velocityPerHour >= cuts.velocityFloorPerHour,
    freshWindow:
      f.ageHoursAtFetch === null || (f.ageHoursAtFetch >= cuts.ageMinHours && f.ageHoursAtFetch < cuts.ageMaxHours),
  };
}

export function flagCount(f: RankFeatures, cuts: FlagCuts): number {
  const fl = flagsOf(f, cuts);
  return Number(fl.media) + Number(fl.smallAuthor) + Number(fl.fast) + Number(fl.freshWindow);
}
