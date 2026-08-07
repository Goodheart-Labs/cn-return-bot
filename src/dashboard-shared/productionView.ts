// The single place that defines the default view of the production review list.
// The client loader in data.ts and App.tsx reads it, and so does the server-side
// prefetch in server.ts. That way the default status and the column lists cannot
// drift apart.

import { FAILURE_TYPE_CONFIG, type FailureType } from "../review-dashboard/src/lib/types";

// The cn_status the default production view shows. It mirrors
// FAILURE_TYPE_CONFIG, where it is the one rated status marked `defaultOn`. The
// client's default filter and the server prefetch both key off it.
export const DEFAULT_VIEW_CN_STATUS = "CURRENTLY_RATED_NOT_HELPFUL";

// The cn_status of every production failure type that is backed by a note. This
// is the inverse of cnStatusToFailureType in data.ts. Four types are left out on
// purpose: lost_to_competitor, missed, low-eval, and underwater. Each of them
// needs data beyond the note row itself, so none can be expressed as a plain
// status filter, and none is part of the fully loaded default set.
export const CN_STATUS_BY_FAILURE_TYPE: Partial<Record<FailureType, string>> = {
  rated_helpful: "CURRENTLY_RATED_HELPFUL",
  rated_unhelpful: "CURRENTLY_RATED_NOT_HELPFUL",
  needs_more_ratings: "NEEDS_MORE_RATINGS",
};

// The production failure types marked `defaultOn`. Together they are the
// standard selection a reviewer lands on. These are loaded in full, with no date
// window, while everything else is windowed. The list is derived from
// FAILURE_TYPE_CONFIG, so changing the default selection also changes what gets
// loaded in full.
export const FULLY_LOADED_FAILURE_TYPES: FailureType[] = (
  Object.entries(FAILURE_TYPE_CONFIG) as [FailureType, (typeof FAILURE_TYPE_CONFIG)[FailureType]][]
)
  .filter(([, cfg]) => cfg.defaultOn && cfg.production)
  .map(([ft]) => ft);

// The cn_statuses that are fully loaded for the default view. They are the
// statuses of the fully loaded failure types. When that leaves nothing, the list
// falls back to DEFAULT_VIEW_CN_STATUS so it is never empty.
export const DEFAULT_VIEW_STATUSES: string[] = (() => {
  const out = FULLY_LOADED_FAILURE_TYPES
    .map((ft) => CN_STATUS_BY_FAILURE_TYPE[ft])
    .filter((s): s is string => !!s);
  return out.length ? out : [DEFAULT_VIEW_CN_STATUS];
})();

// A safety cap on the fetch of the default statuses. The default set holds a few
// hundred rows, so the cap never bites in normal use. It only guards against a
// config change that pulls in a status with an unbounded number of rows.
export const DEFAULT_VIEW_LIMIT = 1000;

// The columns fetched for the list metadata. The big log columns are left out,
// so Postgres never has to read them out of TOAST storage. These are arrays
// because each caller joins them differently. One passes them to supabase-js
// `.select()` and the other builds a raw PostgREST URL.
export const CANONICAL_LIST_COLS = [
  "note_id",
  "tweet_id",
  "note_text",
  "submitted_at",
  "first_seen_at",
  "cn_status",
  "view_count",
  "rating_count",
  "helpful_count",
  "not_helpful_count",
];

export const TWEET_LIST_COLS = [
  "tweet_id",
  "text",
  "media",
  "referenced_tweet_data",
  "author_handle",
  "has_photo",
  "has_video",
  "media_count",
];

export const PUBLIC_DUMP_RATING_COLS = [
  "note_id",
  "helpful_count",
  "somewhat_helpful_count",
  "not_helpful_count",
  "helpful_tag_counts",
  "not_helpful_tag_counts",
  "dump_date",
];
