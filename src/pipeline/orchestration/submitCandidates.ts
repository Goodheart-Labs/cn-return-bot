/**
 * Submit Candidates
 *
 * Phase 2 of the two-phase pipeline. Fetches stored candidates from the DB,
 * ranks them by X API eval score + freshness, and submits
 * the best ones until the daily limit.
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import { rankCandidates, type CandidateForRanking } from "../score/candidateRanker";

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
      },
    };
  });

  // Rank candidates
  const ranked = rankCandidates(candidates);

  // Submit in ranked order until daily limit
  let submitted = 0;

  for (const candidate of ranked) {
    try {
      const { submitNote } = await import("../../api/submitNote");
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
        `[submit] Submitted note for tweet ${candidate.tweetId} (bot: ${candidate.botId}, rank: ${submitted + 1}, score: ${candidate.rankScore.toFixed(3)})`
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

    } catch (err: any) {
      const errorData = err.response?.data;
      const errorText = errorData
        ? JSON.stringify(errorData).slice(0, 500)
        : (err.message || String(err)).slice(0, 500);

      // Detect daily limit
      if (errorText.includes("daily limit")) {
        console.log(`[submit] Daily note limit reached after ${submitted} submissions`);

        // Record limit hit for feed size strategy
        // Bottlenecked = ≤5 notes submitted in last 24h (rolling window)
        try {
          await supabaseLogger.setPipelineState("limit_hit_today", "true");
          const recentCount = await supabaseLogger.countRecentSubmissions(24);
          await supabaseLogger.setPipelineState(
            "bottlenecked",
            recentCount <= 5 ? "true" : "false"
          );
          console.log(`[submit] ${recentCount} notes submitted in last 24h → ${recentCount <= 5 ? "bottlenecked" : "not bottlenecked"}`);
        } catch (stateErr) {
          console.warn("[submit] Failed to record limit hit state:", stateErr);
        }

        break;
      }

      console.error(`[submit] Failed to submit note for tweet ${candidate.tweetId}:`, errorData || err);

      const statusCode = err.response?.status;
      const isIneligible = errorText.includes("ineligible");
      if (statusCode === 404 || isIneligible) {
        const reason = statusCode === 404 ? "tweet_deleted" : "ineligible";
        console.log(`[submit] Tweet ${candidate.tweetId} ${reason} — expiring candidate`);
        try {
          await supabaseLogger.markCandidateExpired(candidate.pipelineRunId, reason);
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
