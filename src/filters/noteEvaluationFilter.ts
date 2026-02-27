import axios from "axios";
import { getOAuth1Headers } from "../api/getOAuthToken";

export type NoteEvaluationResponse = {
  data?: {
    claim_opinion_score: number;
  };
  errors?: any;
};

/**
 * Evaluates a Community Note using X's evaluation endpoint to predict helpfulness
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
  } catch (error) {
    console.error("[noteEvaluationFilter] Error evaluating note:", error);
    throw error;
  }
}

/**
 * Filters a note based on its predicted helpfulness score
 * @param postId The ID of the tweet the note is for
 * @param noteText The text content of the note
 * @param minScore Minimum score threshold (default: -1.5)
 * @returns true if note should be submitted, false if it should be filtered out
 */
export async function shouldSubmitNote(
  postId: string,
  noteText: string,
  minScore: number = -1.5
): Promise<{ shouldSubmit: boolean; score?: number; error?: string }> {
  try {
    const evaluation = await evaluateNote(postId, noteText);

    if (evaluation.errors) {
      console.error("[noteEvaluationFilter] API returned errors:", evaluation.errors);
      return {
        shouldSubmit: false,
        error: "API returned errors",
      };
    }

    if (!evaluation.data || typeof evaluation.data.claim_opinion_score !== 'number') {
      console.error("[noteEvaluationFilter] Invalid response format:", evaluation);
      return {
        shouldSubmit: false,
        error: "Invalid response format",
      };
    }

    const score = evaluation.data.claim_opinion_score;
    const shouldSubmit = score >= minScore;

    console.log(
      `[noteEvaluationFilter] Note evaluation - Score: ${score}, Threshold: ${minScore}, Submit: ${shouldSubmit}`
    );

    return {
      shouldSubmit,
      score,
    };
  } catch (error) {
    console.warn("[noteEvaluationFilter] Evaluation API failed, skipping check:", error instanceof Error ? error.message : error);
    return {
      shouldSubmit: true,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}