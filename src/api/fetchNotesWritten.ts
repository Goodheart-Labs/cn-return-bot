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

export type WrittenNote = {
  id: string;
  post_id: string;
  status?: NoteRatingStatus;
  info?: WrittenNoteInfo;
};

const API_URL = "https://api.x.com/2/notes/search/notes_written";

export async function fetchNotesWritten(): Promise<WrittenNote[]> {
  const allNotes: WrittenNote[] = [];
  let nextToken: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      test_mode: "false",
      max_results: "100",
      "note.fields": "id,info,status",
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
        });
      }
    }

    nextToken = data.meta?.next_token;
    if (!nextToken) break;
  }

  return allNotes;
}
