import axios from "axios";
import { getOAuth1Headers } from "./getOAuthToken";

export type SubmitNoteResponse = {
  data?: any;
  errors?: any;
};

export type NoteInfo = {
  classification: string;
  misleading_tags: string[];
  text: string;
  trustworthy_sources: boolean;
};

/**
 * Submit a Community Note on a tweet. The request is signed with OAuth 1.0a.
 * Outside test mode the note is public. A test-mode note is only scored by
 * X's evaluator, which decides whether a new writer earns admission.
 * @param postId The ID of the tweet to annotate
 * @param info The info object for the note
 * @returns The API response
 */
export async function submitNote(
  postId: string,
  info: NoteInfo,
  testMode = false,
): Promise<SubmitNoteResponse> {
  const url = "https://api.x.com/2/notes";
  const data = {
    info,
    post_id: postId,
    test_mode: testMode,
  };

  const body = JSON.stringify(data);
  const headers = {
    ...getOAuth1Headers(url, "POST", body),
    "Content-Type": "application/json",
  };

  const response = await axios.post(url, data, {
    headers,
    timeout: 30000,
  });
  return response.data;
}
