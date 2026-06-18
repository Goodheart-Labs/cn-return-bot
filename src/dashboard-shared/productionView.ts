// Single source of truth for the production review-list default view, shared by
// the client loader (data.ts / App.tsx) and the server-side prefetch (server.ts)
// so the window size, the default status, and the column lists can't drift apart.

// Initial production window and each "Load older notes" step, in days.
export const WINDOW_DAYS_STEP = 7;

// The cn_status the default production view shows. Mirrors FAILURE_TYPE_CONFIG —
// it's the one rated status that's `defaultOn`. The client default filter and the
// server prefetch both key off this.
export const DEFAULT_VIEW_CN_STATUS = "CURRENTLY_RATED_NOT_HELPFUL";

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
