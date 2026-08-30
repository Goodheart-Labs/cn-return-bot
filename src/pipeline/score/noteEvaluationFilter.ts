import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";
import { getTweetLog } from "../utils/tweetLog";

export type NoteEvaluationResponse = {
  data?: {
    claim_opinion_score: number;
  };
  errors?: any;
};

/**
 * Calls X's evaluation endpoint to predict how helpful a Community Note is.
 * @param postId The ID of the tweet the note is for
 * @param noteText The text content of the note
 * @returns The evaluation response containing the claim_opinion_score
 */
export async function evaluateNote(
  postId: string,
  noteText: string
): Promise<NoteEvaluationResponse> {
  const url = "https://api.x.com/2/evaluate_note";
  const data = {
    post_id: postId,
    note_text: noteText,
  };

  const body = JSON.stringify(data);
  const headers = {
    ...getOAuth1Headers(url, "POST", body),
    "Content-Type": "application/json",
  };

  try {
    const response = await axios.post(url, data, {
      headers,
      timeout: 30000, // 30 second timeout
    });
    return response.data;
  } catch (error: any) {
    console.error("[noteEvaluationFilter] Error evaluating note:", error?.message ?? error);
    throw error;
  }
}

/**
 * Fetches the X eval score (`claim_opinion_score`) for a note. The score is
 * recorded for ranking, analysis, and the submission threshold gate. Returns
 * the score, or an error string when the eval API fails or returns an
 * unexpected shape.
 */
export async function getEvaluationScore(
  postId: string,
  noteText: string
): Promise<{ score?: number; error?: string }> {
  try {
    const evaluation = await evaluateNote(postId, noteText);

    if (evaluation.errors) {
      console.error("[noteEvaluationFilter] API returned errors:", evaluation.errors);
      return { error: "API returned errors" };
    }

    if (!evaluation.data || typeof evaluation.data.claim_opinion_score !== "number") {
      console.error("[noteEvaluationFilter] Invalid response format:", evaluation);
      return { error: "Invalid response format" };
    }

    const score = evaluation.data.claim_opinion_score;
    getTweetLog()?.set("eval.score", score);
    return { score };
  } catch (error) {
    console.warn(
      "[noteEvaluationFilter] Evaluation API failed, skipping:",
      error instanceof Error ? error.message : error
    );
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}
