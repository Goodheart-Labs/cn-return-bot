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

// X only returns `rating_counts_per_model` when `has_access` is true. That
// happens only while the authenticated notewriter is currently top-performing.
// We ask for the field anyway so it works the day our notewriter qualifies.
// Until then it is always missing.
export type NoteScoringStatus = {
  has_access?: boolean;
  rating_counts_per_model?: Record<string, {
    negative_factor_bucket_counts?: NoteFactorBucketCounts;
    neutral_factor_bucket_counts?: NoteFactorBucketCounts;
    positive_factor_bucket_counts?: NoteFactorBucketCounts;
  }>;
};

/** How X's evaluator scored a test-mode note. Each outcome names an
 *  evaluator, such as ClaimOpinion or UrlValidity, and its bucket, such as
 *  high or low. Admission is decided on these (src/x-watch/admission.ts). */
export type NoteTestResult = {
  evaluation_outcome?: { evaluator_type: string; evaluator_score_bucket: string }[];
};

export type WrittenNote = {
  id: string;
  post_id: string;
  status?: NoteRatingStatus;
  info?: WrittenNoteInfo;
  scoring_status?: NoteScoringStatus;
  test_result?: NoteTestResult;
};

const API_URL = "https://api.x.com/2/notes/search/notes_written";

/** Every note the account wrote, newest first. In test mode these are its
 *  test notes with their evaluator scores, and `maxNotes` stops the paging
 *  early. */
export async function fetchNotesWritten(options: { testMode?: boolean; maxNotes?: number } = {}): Promise<WrittenNote[]> {
  const { testMode = false, maxNotes = Infinity } = options;
  const allNotes: WrittenNote[] = [];
  let nextToken: string | undefined;

  while (allNotes.length < maxNotes) {
    const params = new URLSearchParams({
      test_mode: String(testMode),
      max_results: "100",
      "note.fields": testMode ? "id,info,status,test_result" : "id,info,status,scoring_status",
    });
    if (nextToken) params.append("pagination_token", nextToken);

    // OAuth1 requires spaces to be encoded as %20, but URLSearchParams encodes
    // them as +, so we swap them back.
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
          test_result: note.test_result,
        });
      }
    }

    nextToken = data.meta?.next_token;
    if (!nextToken) break;
  }

  return allNotes.slice(0, maxNotes);
}
