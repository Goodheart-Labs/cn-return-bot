/**
 * Submit Candidates
 *
 * Phase 2 of the two-phase pipeline. Fetches stored candidates from the DB,
 * ranks them using composite scoring with softmax sampling, applies the
 * high bar filter floor, and submits the best ones until the daily limit.
 */

import { SupabaseLogger } from "../api/supabaseClient";
import { rankCandidates, type CandidateForRanking } from "../pipeline/candidateRanker";
import { isHighBarFilterEnabled, runHighBarFilter } from "../filters/highBarSubmissionFilter";

export async function submitCandidates(supabaseLogger: SupabaseLogger | null) {
  if (!supabaseLogger) {
    console.log("[submit] No Supabase logger — skipping submission phase");
    return;
  }

  // Fetch all unsubmitted candidates
  const rawCandidates = await supabaseLogger.fetchCandidates();
  if (rawCandidates.length === 0) {
    console.log("[submit] No candidates to submit");
    return;
  }

  console.log(`[submit] Found ${rawCandidates.length} candidates`);

  // Convert to ranking format
  const candidates: CandidateForRanking[] = rawCandidates.map((c) => {
    const scoreMap: Record<string, number> = {};
    for (const s of c.scores) {
      if (s.score_value !== null) {
        scoreMap[s.score_type] = s.score_value;
      }
    }

    return {
      pipelineRunId: c.id,
      tweetId: c.tweet_id,
      noteText: c.note_text,
      sourceUrl: c.source_url,
      botId: c.bot_id,
      createdAt: new Date(c.created_at),
      searchResults: c.search_results ?? "",
      tweetText: c.tweet_text ?? "",
      scores: {
        evaluation: scoreMap["evaluation"],
        sourceTrust: scoreMap["pred_source_trust"],
        llmHelpfulness: scoreMap["pred_llm_helpfulness"],
        sourceVerification: scoreMap["source_verification"],
      },
    };
  });

  // Rank candidates
  const ranked = rankCandidates(candidates);

  // Submit in ranked order until daily limit
  let submitted = 0;
  const highBarEnabled = isHighBarFilterEnabled();

  for (const candidate of ranked) {
    // High bar filter as quality floor
    if (highBarEnabled) {
      const filterResult = await runHighBarFilter(
        candidate.scores.evaluation,
        candidate.sourceUrl,
        candidate.noteText,
        candidate.tweetText,
        candidate.searchResults
      );

      // Log the filter result
      try {
        await supabaseLogger.addPipelineScore(candidate.pipelineRunId, {
          score_type: "high_bar_filter",
          score_value: filterResult.passed ? 1 : 0,
          score_metadata: {
            ...filterResult.scores,
            reason: filterResult.reason,
            phase: "submission",
          },
        });
      } catch (err) {
        console.warn(`[submit] Failed to log high bar filter score:`, err);
      }

      if (!filterResult.passed) {
        console.log(
          `[submit] Candidate ${candidate.pipelineRunId.slice(0, 8)} below quality floor: ${filterResult.reason}`
        );
        continue;
      }
    }

    // Try to submit
    try {
      const { submitNote } = await import("../api/submitNote");
      const info = {
        classification: "misinformed_or_potentially_misleading",
        misleading_tags: ["disputed_claim_as_fact"],
        text: candidate.noteText,
        trustworthy_sources: true,
      };
      const response = await submitNote(candidate.tweetId, info);
      const noteId = response?.data?.id;

      if (!noteId) {
        console.error(
          `[submit] submitNote returned success but no note ID for tweet ${candidate.tweetId}. Response:`,
          JSON.stringify(response?.data)
        );
        continue;
      }

      console.log(
        `[submit] Submitted note for tweet ${candidate.tweetId} (bot: ${candidate.botId}, rank: ${submitted + 1}, score: ${candidate.freshnessAdjustedScore.toFixed(3)})`
      );
      submitted++;

      // Mark candidate as submitted
      await supabaseLogger.markCandidateSubmitted(candidate.pipelineRunId, noteId);

      // Log to notes table
      try {
        const botConfig = await supabaseLogger.getOrCreateBotConfig(candidate.botId);
        await supabaseLogger.logNoteSubmission({
          note_id: noteId,
          tweet_id: candidate.tweetId,
          bot_config_id: botConfig.id,
          bot_name: candidate.botId,
          note_text: candidate.noteText,
          source_url: candidate.sourceUrl,
          evaluation_score: candidate.scores.evaluation,
          commit_sha: process.env.GITHUB_SHA,
        });
        console.log(`[submit] Logged note ${noteId} to Supabase (bot: ${candidate.botId})`);
      } catch (logErr) {
        console.error("[submit] Failed to log to Supabase:", logErr);
      }

      // Fire-and-forget: run prediction scores
      try {
        const { runPredictionScores } = await import("../pipeline/predictionScores");
        runPredictionScores({
          pipelineRunId: candidate.pipelineRunId,
          noteText: candidate.noteText,
          sourceUrl: candidate.sourceUrl,
          tweetText: candidate.tweetText,
          searchResults: candidate.searchResults,
          postId: candidate.tweetId,
          supabaseLogger,
          preComputed: {
            sourceTrust: candidate.scores.sourceTrust,
            llmHelpfulness: candidate.scores.llmHelpfulness,
            claimOpinionScore: candidate.scores.evaluation,
          },
        }).catch((err) =>
          console.warn("[submit] Prediction scores failed (non-fatal):", err)
        );
      } catch (err) {
        console.warn("[submit] Failed to start prediction scores:", err);
      }
    } catch (err: any) {
      const errorData = err.response?.data;
      const errorText = errorData
        ? JSON.stringify(errorData).slice(0, 500)
        : (err.message || String(err)).slice(0, 500);

      // Detect daily limit
      if (errorText.includes("daily limit")) {
        console.log(`[submit] Daily note limit reached after ${submitted} submissions`);
        break;
      }

      console.error(`[submit] Failed to submit note for tweet ${candidate.tweetId}:`, errorData || err);

      // Only expire on 404 (tweet deleted) — everything else is retryable
      const statusCode = err.response?.status;
      if (statusCode === 404) {
        console.log(`[submit] Tweet ${candidate.tweetId} deleted — expiring candidate`);
        try {
          await supabaseLogger.markCandidateExpired(candidate.pipelineRunId, "tweet_deleted");
        } catch (logErr) {
          console.warn("[submit] Failed to mark candidate as expired:", logErr);
        }
      } else {
        console.log(`[submit] Error submitting ${candidate.tweetId} (${statusCode ?? "no status"}) — will retry next run`);
      }
    }
  }

  console.log(`[submit] Submitted ${submitted} of ${ranked.length} ranked candidates`);
}
