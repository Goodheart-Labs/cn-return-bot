import axios from "axios";
import { getOAuth1Headers } from "./getOAuthToken";

export type NoteRatingStatus =
  | "currently_rated_helpful"
  | "currently_rated_not_helpful"
  | "firm_reject"
  | "insufficient_consensus"
  | "minimum_ratings_not_met"
  | "needs_more_ratings"
  | "needs_your_help";

export type WrittenNoteInfo = {
  text: string;
  classification: string;
  misleading_tags: string[];
  trustworthy_sources: boolean;
};

export type NoteFactorBucketCounts = {
  helpful_count?: number;
  somewhat_helpful_count?: number;
  not_helpful_count?: number;
  helpful_tag_counts?: { tag_name: string; tag_count: number };
  not_helpful_tag_counts?: { tag_name: string; tag_count: number };
};

// `rating_counts_per_model` is gated on `has_access` (only true when the
// authenticated notewriter is currently top-performing). We request the field
// to future-proof; today it's always missing because our notewriter doesn't
// qualify yet.
export type NoteScoringStatus = {
  has_access?: boolean;
  rating_counts_per_model?: Record<string, {
    negative_factor_bucket_counts?: NoteFactorBucketCounts;
    neutral_factor_bucket_counts?: NoteFactorBucketCounts;
    positive_factor_bucket_counts?: NoteFactorBucketCounts;
  }>;
};

export type WrittenNote = {
  id: string;
  post_id: string;
  status?: NoteRatingStatus;
  info?: WrittenNoteInfo;
  scoring_status?: NoteScoringStatus;
};

const API_URL = "https://api.x.com/2/notes/search/notes_written";

export async function fetchNotesWritten(): Promise<WrittenNote[]> {
  const allNotes: WrittenNote[] = [];
  let nextToken: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      test_mode: "false",
      max_results: "100",
      "note.fields": "id,info,status,scoring_status",
    });
    if (nextToken) params.append("pagination_token", nextToken);

    // OAuth1 requires %20 for spaces; URLSearchParams uses +
    const fullUrl = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
    const response = await axios.get(fullUrl, {
      headers: { ...getOAuth1Headers(fullUrl, "GET"), "Content-Type": "application/json" },
      timeout: 30_000,
    });

    const data = response.data;
    if (data.data) {
      for (const note of data.data) {
        allNotes.push({
          id: note.id,
          post_id: note.post_id ?? note.info?.post_id,
          status: note.status,
          info: note.info,
          scoring_status: note.scoring_status,
        });
      }
    }

    nextToken = data.meta?.next_token;
    if (!nextToken) break;
  }

  return allNotes;
}
