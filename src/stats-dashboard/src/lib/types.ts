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
  source_url: string | null;
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

export interface StatsSnapshot {
  generated_at: string;
  notes: NoteRecord[];
  pipeline_run_aggregates: PipelineRunAggregate[];
  pipeline_runs_by_day: PipelineRunDayBucket[];
  ab_test_slots: ABTestSlotInfo[];
}

export type ChartGranularity = "daily" | "weekly";
export type ChartMode = "absolute" | "ratio";
export type NoteSort = "latest_helpful" | "most_views_helpful" | "latest_unhelpful";
