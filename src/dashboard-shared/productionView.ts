// Single source of truth for the production review-list default view, shared by
// the client loader (data.ts / App.tsx) and the server-side prefetch (server.ts)
// so the default status and the column lists can't drift apart.

import { FAILURE_TYPE_CONFIG, type FailureType } from "../review-dashboard/src/lib/types";

// The cn_status the default production view shows. Mirrors FAILURE_TYPE_CONFIG —
// it's the one rated status that's `defaultOn`. The client default filter and the
// server prefetch both key off this.
export const DEFAULT_VIEW_CN_STATUS = "CURRENTLY_RATED_NOT_HELPFUL";

// cn_status per note-backed production failure type — the inverse of
// cnStatusToFailureType (data.ts). Types needing satellite data
// (lost_to_competitor / missed / low-eval / underwater) are intentionally absent:
// they can't be a plain status filter and are never part of the fully-loaded
// default set.
export const CN_STATUS_BY_FAILURE_TYPE: Partial<Record<FailureType, string>> = {
  rated_helpful: "CURRENTLY_RATED_HELPFUL",
  rated_unhelpful: "CURRENTLY_RATED_NOT_HELPFUL",
  needs_more_ratings: "NEEDS_MORE_RATINGS",
};

// Production failure types that are defaultOn — the "standard selection" the
// reviewer lands on. These are loaded in FULL (no date window); everything else is
// windowed. Auto-tracks FAILURE_TYPE_CONFIG, so changing the default selection
// changes what gets fully loaded.
export const FULLY_LOADED_FAILURE_TYPES: FailureType[] = (
  Object.entries(FAILURE_TYPE_CONFIG) as [FailureType, (typeof FAILURE_TYPE_CONFIG)[FailureType]][]
)
  .filter(([, cfg]) => cfg.defaultOn && cfg.production)
  .map(([ft]) => ft);

// The cn_statuses fully loaded for the default view (the statuses of the
// fully-loaded types). Falls back to DEFAULT_VIEW_CN_STATUS so it's never empty.
export const DEFAULT_VIEW_STATUSES: string[] = (() => {
  const out = FULLY_LOADED_FAILURE_TYPES
    .map((ft) => CN_STATUS_BY_FAILURE_TYPE[ft])
    .filter((s): s is string => !!s);
  return out.length ? out : [DEFAULT_VIEW_CN_STATUS];
})();

// Safety cap on the full default-status fetch. The default set is small (~hundreds);
// this only guards against a config change pulling in an unbounded status.
export const DEFAULT_VIEW_LIMIT = 1000;

// Column lists for the list-metadata fetch (no TOAST/logs columns). Arrays so
// each caller joins as it needs: supabase-js `.select()` vs a raw PostgREST URL.
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
