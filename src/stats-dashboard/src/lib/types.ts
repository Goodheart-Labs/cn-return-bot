import type { PublicDumpRatings, ReferencedTweetData, TweetMediaItem } from "../../../dashboard-shared/types";
import type { ABTestSlotInfo } from "../../../dashboard-shared/abFilters";

export type CnStatus =
  | "CURRENTLY_RATED_HELPFUL"
  | "CURRENTLY_RATED_NOT_HELPFUL"
  | "NEEDS_MORE_RATINGS"
  | null;

export interface NoteTweetData {
  text: string | null;
  handle: string | null;
  media: TweetMediaItem[] | null;
  referenced_tweet_data: ReferencedTweetData | null;
  has_photo: boolean;
  has_video: boolean;
  media_count: number;
}

export interface NoteRecord {
  note_id: string;
  tweet_id: string;
  submitted_at: string;
  cn_status: CnStatus;
  view_count: number;
  helpful_count: number;
  not_helpful_count: number;
  rating_count: number;
  note_text: string;
  ab_test_picks: Record<string, string> | null;
  cost: number | null;
  tweet: NoteTweetData | null;
  public_dump_ratings: PublicDumpRatings | null;
}

export interface PipelineRunAggregate {
  ab_test_picks_key: string;
  ab_test_picks: Record<string, string> | null;
  total_cost: number;
  run_count: number;
}

// Per-day rollup of pipeline_runs so the dashboard can compute
// non-candidate counts (runs that didn't end up as a submitted note) per
// bucket without shipping every individual run row.
export interface PipelineRunDayBucket {
  date: string;                              // YYYY-MM-DD (created_at, UTC)
  ab_test_picks: Record<string, string> | null;
  total_count: number;
  submitted_count: number;
}

// Per-UTC-day origin split of rated-helpful Community Notes from the X public
// dump. Human-written helpful = helpful_total - helpful_ours - helpful_other_ai.
export interface DailyOriginCount {
  day: string;                               // YYYY-MM-DD (createdAtMillis, UTC)
  helpful_total: number;
  helpful_ours: number;
  helpful_other_ai: number;                  // top-9 other AI notewriters
}

export interface StatsSnapshot {
  generated_at: string;
  notes: NoteRecord[];
  pipeline_run_aggregates: PipelineRunAggregate[];
  pipeline_runs_by_day: PipelineRunDayBucket[];
  ab_test_slots: ABTestSlotInfo[];
  daily_note_origin_counts: DailyOriginCount[];
}

export type ChartGranularity = "daily" | "weekly";
export type ChartMode = "absolute" | "ratio" | "share";
export type NoteSort = "latest_helpful" | "most_views_helpful" | "latest_unhelpful";
