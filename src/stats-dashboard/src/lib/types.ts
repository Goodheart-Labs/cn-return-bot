import type { ReferencedTweetData, TweetMediaItem } from "../../../dashboard-shared/types";

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
}

export interface PipelineRunAggregate {
  ab_test_picks_key: string;
  ab_test_picks: Record<string, string> | null;
  total_cost: number;
  run_count: number;
}

export interface ABTestSlotInfo {
  name: string;
  variants: string[];
}

export interface StatsSnapshot {
  generated_at: string;
  notes: NoteRecord[];
  pipeline_run_aggregates: PipelineRunAggregate[];
  ab_test_slots: ABTestSlotInfo[];
}

export type ChartGranularity = "daily" | "weekly";
export type ChartMode = "absolute" | "ratio";
export type NoteSort = "latest_helpful" | "most_views_helpful" | "latest_unhelpful";

export type ABFilters = Record<string, string | undefined>;
