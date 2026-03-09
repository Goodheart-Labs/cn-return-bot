/**
 * Generate Candidates
 *
 * Phase 1 of the two-phase pipeline. Fetches eligible tweets, runs bot
 * pipelines to write notes, scores them, and stores as candidates in
 * pipeline_runs. Does NOT submit — that's submitCandidates.ts.
 */

import { fetchEligiblePosts } from "../api/fetchEligiblePosts";
import { SupabaseLogger } from "../api/supabaseClient";
import { getOriginalTweetContent } from "../utils/retweetUtils";
import { closeBrowser } from "../pipeline/browserManager";
import { selectRandomBot, getBotProbabilities } from "../bots";
import PQueue from "p-queue";

const maxPosts = 20;
const concurrencyLimit = 5;

export async function generateCandidates(supabaseLogger: SupabaseLogger | null) {
  const commit = process.env.GITHUB_SHA;

  // Log bot selection probabilities
  const botProbs = getBotProbabilities();
  console.log(`[generate] Bot selection probabilities:`);
  botProbs.forEach((b) => {
    console.log(`  - ${b.id}: ${b.probability.toFixed(1)}%`);
  });

  // Get tweet IDs to skip (submitted + candidates + NCN cooldown/permanent)
  let skipPostIds = new Set<string>();
  let allProcessedIds = new Set<string>();
  if (supabaseLogger) {
    try {
      skipPostIds = await supabaseLogger.getProcessedTweetIds();
      allProcessedIds = await supabaseLogger.getAllProcessedTweetIds();
      const backlogSize = allProcessedIds.size - skipPostIds.size;
      console.log(
        `[generate] Skipping ${skipPostIds.size} posts, ${allProcessedIds.size} total ever processed, ${backlogSize} in retry backlog`
      );
    } catch (err) {
      console.warn("[generate] Failed to get processed tweet IDs:", err);
    }
  }

  // Fetch eligible posts
  const BACKLOG_LIMIT = 1000;
  const allEligible = await fetchEligiblePosts(BACKLOG_LIMIT, skipPostIds, 50);

  // Sort newest first
  allEligible.sort((a, b) => {
    const idA = BigInt(a.id);
    const idB = BigInt(b.id);
    return idA > idB ? -1 : idA < idB ? 1 : 0;
  });

  // Separate new vs retries
  const newPosts = allEligible.filter((p) => !allProcessedIds.has(p.id));
  const retryPosts = allEligible.filter(
    (p) => allProcessedIds.has(p.id) && !skipPostIds.has(p.id)
  );

  const backlogTotal = allEligible.length;
  const backlogHitLimit = backlogTotal >= BACKLOG_LIMIT;
  console.log(
    `[generate] Backlog: ${backlogTotal} eligible tweets (${newPosts.length} new, ${retryPosts.length} retries)${backlogHitLimit ? " — hit limit, true backlog may be larger" : ""}`
  );

  // New tweets first, then fill remaining slots with retries
  const posts = [
    ...newPosts.slice(0, maxPosts),
    ...retryPosts.slice(0, Math.max(0, maxPosts - newPosts.length)),
  ].slice(0, maxPosts);

  console.log(
    `[generate] Processing ${posts.length} of ${backlogTotal} (${posts.filter((p) => !allProcessedIds.has(p.id)).length} new + ${posts.filter((p) => allProcessedIds.has(p.id)).length} retries)`
  );

  // Log run snapshot
  if (supabaseLogger) {
    try {
      await supabaseLogger.logRunSnapshot({
        backlog_total: backlogTotal,
        backlog_new: newPosts.length,
        backlog_retry: retryPosts.length,
        backlog_hit_limit: backlogHitLimit,
        posts_processed: posts.length,
        commit_sha: commit,
      });
    } catch (err) {
      console.warn("[generate] Failed to log run snapshot:", err);
    }
  }

  if (!posts.length) {
    console.log("[generate] No eligible posts found.");
    return;
  }

  // Log media breakdown
  const videoCount = posts.filter((p) => p.media?.some((m) => m.type === "video")).length;
  const photoCount = posts.filter(
    (p) => p.media?.some((m) => m.type === "photo") && !p.media?.some((m) => m.type === "video")
  ).length;
  const textOnlyCount = posts.filter((p) => !p.media || p.media.length === 0).length;
  console.log(
    `[generate] Media breakdown: ${videoCount} video, ${photoCount} photo-only, ${textOnlyCount} text-only`
  );

  const queue = new PQueue({ concurrency: concurrencyLimit });
  const botUsage: Record<string, number> = {};
  let candidateCount = 0;

  for (const [idx, post] of posts.entries()) {
    queue.add(async () => {
      const content = getOriginalTweetContent(post);
      const hasVideo = post.media?.some((m) => m.type === "video") ?? false;
      const hasPhoto = post.media?.some((m) => m.type === "photo") ?? false;
      const videoMedia = post.media?.find((m) => m.type === "video");

      console.log(
        `[generate] Processing post #${idx + 1} (ID: ${post.id}) - ${content.isQuoteTweet ? "quote tweet" : "original"}${hasVideo ? " [VIDEO]" : ""}`
      );

      // Create pipeline run with tweet engagement metrics
      let pipelineRunId: string | null = null;
      if (supabaseLogger) {
        try {
          pipelineRunId = await supabaseLogger.createPipelineRun({
            tweet_id: post.id,
            author_id: post.author_id,
            tweet_text: post.text.slice(0, 500),
            has_video: hasVideo,
            has_photo: hasPhoto,
            media_count: post.media?.length ?? 0,
            video_duration_ms: videoMedia?.duration_ms,
            commit_sha: commit,
            tweet_impressions: post.public_metrics?.impression_count,
            tweet_likes: post.public_metrics?.like_count,
            tweet_retweets: post.public_metrics?.retweet_count,
            tweet_replies: post.public_metrics?.reply_count,
            tweet_quotes: post.public_metrics?.quote_count,
            tweet_bookmarks: post.public_metrics?.bookmark_count,
            author_followers: post.author_followers,
          });
        } catch (err) {
          console.warn(`[generate] Failed to create pipeline run for ${post.id}:`, err);
        }
      }

      // Select bot and run pipeline
      const selectedBot = selectRandomBot();
      console.log(`[generate] Tweet ${post.id} with bot: ${selectedBot.id}`);
      botUsage[selectedBot.id] = (botUsage[selectedBot.id] || 0) + 1;

      const result = await selectedBot.runPipeline(post, content);

      const warningText = result?.warnings?.length
        ? `[WARNINGS] ${result.warnings.join("; ")}`
        : undefined;
      if (warningText) {
        console.warn(`[generate] Tweet ${post.id}: ${warningText}`);
      }

      // Handle pipeline failure
      if (!result) {
        if (supabaseLogger && pipelineRunId) {
          try {
            await supabaseLogger.completePipelineRun(pipelineRunId, {
              outcome: "failed",
              outcome_reason: "bot_returned_null",
              final_stage: "started",
              bot_id: selectedBot.id,
            });
          } catch (err) {
            console.warn(`[generate] Failed to complete pipeline run:`, err);
          }
        }
        return;
      }

      // Handle bot error
      if (result.error) {
        if (supabaseLogger && pipelineRunId) {
          try {
            await supabaseLogger.completePipelineRun(pipelineRunId, {
              outcome: "failed",
              outcome_reason: "bot_error",
              error_message: [warningText, result.error].filter(Boolean).join(" | ").slice(0, 2000),
              final_stage: result.lastStage,
              bot_id: selectedBot.id,
              note_text: result.noteResult?.note,
              source_url: result.noteResult?.url,
              note_status: result.noteResult?.status,
              search_results: result.searchContextResult?.searchResults?.slice(0, 10000),
              check_reasoning: result.checkResult,
            });
          } catch (err) {
            console.warn(`[generate] Failed to complete pipeline run:`, err);
          }
        }
        return;
      }

      // Log source verification score
      const checkSkipped = result.checkResult == null;
      const checkRaw = result.checkResult?.trim().toUpperCase() ?? "";
      const checkYes = checkSkipped || checkRaw === "YES";
      const checkError = checkRaw.startsWith("ERROR");

      if (supabaseLogger && pipelineRunId && !checkSkipped) {
        try {
          await supabaseLogger.addPipelineScore(pipelineRunId, {
            score_type: "source_verification",
            score_value: checkRaw === "YES" ? 1 : 0,
            score_label: checkRaw,
          });
        } catch (err) {
          console.warn(`[generate] Failed to log check score:`, err);
        }
      }

      // Log scoring filter results if present
      const scoringResults = (result as any).scoringResults;
      if (supabaseLogger && pipelineRunId && scoringResults) {
        try {
          if (scoringResults.positive) {
            await supabaseLogger.addPipelineScore(pipelineRunId, {
              score_type: "positive_claims",
              score_value: scoringResults.positive.score,
              score_metadata: { reasoning: scoringResults.positive.reasoning },
            });
          }
          if (scoringResults.disagreement) {
            await supabaseLogger.addPipelineScore(pipelineRunId, {
              score_type: "disagreement",
              score_value: scoringResults.disagreement.score,
              score_metadata: { reasoning: scoringResults.disagreement.reasoning },
            });
          }
          if (scoringResults.helpfulness) {
            await supabaseLogger.addPipelineScore(pipelineRunId, {
              score_type: "helpfulness",
              score_value: scoringResults.helpfulness.score,
              score_metadata: { reasoning: scoringResults.helpfulness.reasoning },
            });
          }
        } catch (err) {
          console.warn(`[generate] Failed to log scoring filter results:`, err);
        }
      }

      // Common data for all completions
      const noteText = result.noteResult.note + " " + result.noteResult.url;
      const completionBase = {
        bot_id: selectedBot.id,
        note_text: noteText,
        source_url: result.noteResult.url,
        note_status: result.noteResult.status,
        search_results: result.searchContextResult.searchResults?.slice(0, 10000),
        check_reasoning: result.checkResult,
      };

      // Check statuses that mean "no usable note"
      if (result.noteResult.status === "SCORING_FILTERS_FAILED") {
        if (supabaseLogger && pipelineRunId) {
          try {
            await supabaseLogger.completePipelineRun(pipelineRunId, {
              ...completionBase,
              outcome: "rejected",
              outcome_reason: "scoring_filters_failed",
              error_message: warningText,
              final_stage: "scoring",
            });
          } catch (err) {
            console.warn(`[generate] Failed to complete pipeline run:`, err);
          }
        }
        return;
      }

      if (result.noteResult.status === "SOURCE_TRUST_FAILED") {
        if (supabaseLogger && pipelineRunId) {
          try {
            await supabaseLogger.completePipelineRun(pipelineRunId, {
              ...completionBase,
              outcome: "rejected",
              outcome_reason: "source_trust_failed",
              error_message: warningText,
              final_stage: "source_trust",
            });
          } catch (err) {
            console.warn(`[generate] Failed to complete pipeline run:`, err);
          }
        }
        return;
      }

      if (result.noteResult.status !== "CORRECTION WITH TRUSTWORTHY CITATION") {
        if (supabaseLogger && pipelineRunId) {
          try {
            await supabaseLogger.completePipelineRun(pipelineRunId, {
              ...completionBase,
              outcome: "rejected",
              outcome_reason: "no_correction_needed",
              error_message: warningText,
              final_stage: "note_writing",
            });
          } catch (err) {
            console.warn(`[generate] Failed to complete pipeline run:`, err);
          }
        }
        return;
      }

      if (!checkYes) {
        if (supabaseLogger && pipelineRunId) {
          try {
            const checkReasonText = checkRaw ? `check: ${checkRaw}` : undefined;
            await supabaseLogger.completePipelineRun(pipelineRunId, {
              ...completionBase,
              outcome: checkError ? "failed" : "rejected",
              outcome_reason: checkError ? "check_error" : "check_failed",
              error_message: [warningText, checkReasonText].filter(Boolean).join(" | ").slice(0, 2000) || undefined,
              final_stage: "check",
            });
          } catch (err) {
            console.warn(`[generate] Failed to complete pipeline run:`, err);
          }
        }
        return;
      }

      // Run eval to get the X API score (used for ranking)
      let evaluationScore: number | undefined;
      try {
        const { shouldSubmitNote } = await import("../filters/noteEvaluationFilter");
        const evaluationResult = await shouldSubmitNote(result.post.id, noteText, 0);
        evaluationScore = evaluationResult.score;

        if (supabaseLogger && pipelineRunId) {
          try {
            await supabaseLogger.addPipelineScore(pipelineRunId, {
              score_type: "evaluation",
              score_value: evaluationResult.score,
              score_metadata: evaluationResult.error ? { error: evaluationResult.error } : undefined,
            });
          } catch (err) {
            console.warn(`[generate] Failed to log evaluation score:`, err);
          }
        }

        // If eval explicitly says don't submit (score below 0), reject
        if (!evaluationResult.shouldSubmit && !evaluationResult.error) {
          const evalErrorText = evaluationResult.score !== undefined
            ? `score ${evaluationResult.score} below threshold`
            : undefined;
          if (supabaseLogger && pipelineRunId) {
            try {
              await supabaseLogger.completePipelineRun(pipelineRunId, {
                ...completionBase,
                outcome: "rejected",
                outcome_reason: "low_evaluation_score",
                error_message: [warningText, evalErrorText].filter(Boolean).join(" | ").slice(0, 2000) || undefined,
                final_stage: "evaluation",
              });
            } catch (err) {
              console.warn(`[generate] Failed to complete pipeline run:`, err);
            }
          }
          return;
        }
      } catch (err: any) {
        console.warn(`[generate] Eval API failed for ${post.id}, storing candidate without eval score:`, err?.message);
      }

      // Source count (free, no LLM)
      let sourceCountScore: number | undefined;
      try {
        const { countSources } = await import("../pipeline/scoringFilters");
        sourceCountScore = countSources(noteText);
        if (supabaseLogger && pipelineRunId) {
          await supabaseLogger.addPipelineScore(pipelineRunId, {
            score_type: "pred_source_count",
            score_value: sourceCountScore,
          });
        }
      } catch (err: any) {
        console.warn(`[generate] Source count failed:`, err?.message);
      }

      // Expire any existing candidates for this tweet (re-roll replaces old candidate)
      if (supabaseLogger && pipelineRunId) {
        try {
          const existing = await supabaseLogger.fetchAllRows<{ id: string }>(
            (client) => client.from("pipeline_runs").select("id")
              .eq("tweet_id", post.id)
              .eq("outcome", "candidate")
              .neq("id", pipelineRunId)
          );
          for (const old of existing) {
            await supabaseLogger.markCandidateExpired(old.id, "rerolled");
            console.log(`[generate] Expired old candidate ${old.id.slice(0, 8)} for tweet ${post.id} (re-roll)`);
          }
        } catch (err) {
          console.warn(`[generate] Failed to expire old candidates:`, err);
        }

        // Store as candidate
        try {
          await supabaseLogger.completePipelineRun(pipelineRunId, {
            ...completionBase,
            outcome: "candidate",
            outcome_reason: undefined,
            error_message: warningText,
            final_stage: "candidate",
          });
          candidateCount++;
          console.log(
            `[generate] Stored candidate for tweet ${post.id} (eval=${evaluationScore?.toFixed(2) ?? "?"}, srcs=${sourceCountScore ?? "?"})`
          );
        } catch (err) {
          console.warn(`[generate] Failed to store candidate:`, err);
        }
      }
    });
  }

  await queue.onIdle();

  // Log summary
  console.log(`[generate] Bot usage summary:`);
  Object.entries(botUsage).forEach(([botId, count]) => {
    console.log(`  - ${botId}: ${count} tweets`);
  });
  console.log(`[generate] Processed ${posts.length} posts, stored ${candidateCount} candidates`);
}
