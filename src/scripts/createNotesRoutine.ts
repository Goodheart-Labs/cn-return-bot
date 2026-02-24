import { fetchEligiblePosts } from "../api/fetchEligiblePosts";
import { SupabaseLogger } from "../api/supabaseClient";
import { getOriginalTweetContent } from "../utils/retweetUtils";
import { closeBrowser } from "../pipeline/browserManager";
import PQueue from "p-queue";
import {
  selectRandomBot,
  getBotProbabilities,
} from "../bots";

const maxPosts = 10; // Maximum posts to process per run
const concurrencyLimit = 3; // Process 3 posts at a time to avoid rate limiting
const MAX_RUNTIME_MS = 5 * 60 * 1000; // 5 minutes maximum runtime

// Global timeout to prevent hanging
const globalTimeout = setTimeout(async () => {
  console.log("[main] Maximum runtime reached (5 minutes), forcing exit");
  await closeBrowser();
  process.exit(0);
}, MAX_RUNTIME_MS);

async function main() {
  try {
    // Always submit notes (all bots run in production mode)
    const shouldSubmitNotes = true;

    // Log bot selection probabilities
    const botProbs = getBotProbabilities();
    console.log(`[main] Bot selection probabilities:`);
    botProbs.forEach((b) => {
      console.log(`  - ${b.id}: ${b.probability.toFixed(1)}%`);
    });

    // Get commit hash from environment variable (available in GitHub Actions)
    const commit = process.env.GITHUB_SHA;

    // Initialize Supabase logger (optional - only if env vars are set)
    let supabaseLogger: SupabaseLogger | null = null;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      try {
        supabaseLogger = new SupabaseLogger();
        console.log(`[main] Supabase logging enabled`);
      } catch (err) {
        console.warn("[main] Failed to initialize Supabase logger:", err);
        supabaseLogger = null;
      }
    } else {
      console.log("[main] Supabase logging disabled (env vars not set)");
    }

    // Track bot usage for summary
    const botUsage: Record<string, number> = {};

    // Get tweet IDs to permanently skip (submitted + 2x no-correction-needed)
    let skipPostIds = new Set<string>();
    let allProcessedIds = new Set<string>();
    if (supabaseLogger) {
      try {
        skipPostIds = await supabaseLogger.getProcessedTweetIds();
        allProcessedIds = await supabaseLogger.getAllProcessedTweetIds();
        const backlogSize = allProcessedIds.size - skipPostIds.size;
        console.log(`[main] Permanently skipping ${skipPostIds.size} posts, ${allProcessedIds.size} total ever processed, ${backlogSize} in retry backlog`);
      } catch (err) {
        console.warn("[main] Failed to get processed tweet IDs:", err);
      }
    } else {
      console.log("[main] No Supabase logger - not skipping any posts");
    }

    // Fetch eligible posts (up to 200) to measure true backlog, only excluding permanently-skipped tweets
    const BACKLOG_LIMIT = 200;
    const allEligible = await fetchEligiblePosts(BACKLOG_LIMIT, skipPostIds, 10);

    // Separate into new tweets and retries
    const newPosts = allEligible.filter((p) => !allProcessedIds.has(p.id));
    const retryPosts = allEligible.filter((p) => allProcessedIds.has(p.id) && !skipPostIds.has(p.id));

    // Log backlog size (full eligible pool from API)
    const backlogNew = newPosts.length;
    const backlogRetry = retryPosts.length;
    const backlogTotal = allEligible.length;
    const backlogHitLimit = backlogTotal >= BACKLOG_LIMIT;
    console.log(`[main] Backlog: ${backlogTotal} eligible tweets (${backlogNew} new, ${backlogRetry} retries)${backlogHitLimit ? " — hit limit, true backlog may be larger" : ""}`);

    // New tweets first, then fill remaining slots with retries — only process maxPosts
    const posts = [
      ...newPosts.slice(0, maxPosts),
      ...retryPosts.slice(0, Math.max(0, maxPosts - newPosts.length)),
    ].slice(0, maxPosts);

    console.log(`[main] Processing ${posts.length} of ${backlogTotal} (${posts.filter((p) => !allProcessedIds.has(p.id)).length} new + ${posts.filter((p) => allProcessedIds.has(p.id)).length} retries)`);

    // Persist backlog snapshot for trend tracking
    if (supabaseLogger) {
      try {
        await supabaseLogger.logRunSnapshot({
          backlog_total: backlogTotal,
          backlog_new: backlogNew,
          backlog_retry: backlogRetry,
          backlog_hit_limit: backlogHitLimit,
          posts_processed: posts.length,
          commit_sha: commit,
        });
      } catch (err) {
        console.warn("[main] Failed to log run snapshot:", err);
      }
    }

    if (!posts.length) {
      console.log("No eligible posts found (new or retryable).");
      clearTimeout(globalTimeout);
      await closeBrowser();
      process.exit(0);
    }

    // Log media breakdown for tracking
    const videoCount = posts.filter((p) =>
      p.media?.some((m) => m.type === "video")
    ).length;
    const photoCount = posts.filter(
      (p) =>
        p.media?.some((m) => m.type === "photo") &&
        !p.media?.some((m) => m.type === "video")
    ).length;
    const textOnlyCount = posts.filter(
      (p) => !p.media || p.media.length === 0
    ).length;
    console.log(
      `[main] Media breakdown: ${videoCount} video (${((videoCount / posts.length) * 100).toFixed(0)}%), ${photoCount} photo-only, ${textOnlyCount} text-only`
    );

    console.log(`[main] Starting pipelines for ${posts.length} posts...`);

    const queue = new PQueue({ concurrency: concurrencyLimit });
    let submitted = 0;

    // Add progress logging
    queue.on("active", () => {
      console.log(`[queue] Task started - ${queue.size} remaining in queue`);
    });

    // Add all tasks to the queue
    for (const [idx, post] of posts.entries()) {
      queue.add(async () => {
        // Get the original tweet content (handling retweets)
        const content = getOriginalTweetContent(post);

        // Check for video content
        const hasVideo = post.media?.some((m) => m.type === "video") ?? false;
        const hasPhoto = post.media?.some((m) => m.type === "photo") ?? false;
        const videoMedia = post.media?.find((m) => m.type === "video");

        console.log(
          `[main] Processing post #${idx + 1} (ID: ${post.id}) - ${
            content.isRetweet ? "retweet" : "original"
          }${hasVideo ? " [VIDEO]" : ""}`
        );

        // Create pipeline run for tracking
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
            });
          } catch (err) {
            console.warn(`[main] Failed to create pipeline run for ${post.id}:`, err);
          }
        }

        // Select a random bot and run it (LLM layer handles retries for transient errors)
        const selectedBot = selectRandomBot();
        console.log(
          `[main] Tweet ${post.id} with bot: ${selectedBot.id}`
        );
        botUsage[selectedBot.id] = (botUsage[selectedBot.id] || 0) + 1;

        const result = await selectedBot.runPipeline(post, content);

        // Handle pipeline failure (bot returned null)
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
              console.warn(`[main] Failed to complete pipeline run:`, err);
            }
          }
          return;
        }

        // Handle bot error (returned result with error)
        if (result.error) {
          if (supabaseLogger && pipelineRunId) {
            try {
              await supabaseLogger.completePipelineRun(pipelineRunId, {
                outcome: "failed",
                outcome_reason: "bot_error",
                error_message: result.error.slice(0, 500),
                final_stage: result.lastStage,
                bot_id: selectedBot.id,
              });
            } catch (err) {
              console.warn(`[main] Failed to complete pipeline run:`, err);
            }
          }
          return;
        }

        // Check if the source verification passed
        const checkRaw = result.checkResult?.trim().toUpperCase() ?? "";
        const checkYes = checkRaw === "YES";
        const checkError = checkRaw.startsWith("ERROR");

        // Log check score
        if (supabaseLogger && pipelineRunId) {
          try {
            await supabaseLogger.addPipelineScore(pipelineRunId, {
              score_type: "check",
              score_label: result.checkResult?.trim().toUpperCase(),
            });
          } catch (err) {
            console.warn(`[main] Failed to log check score:`, err);
          }
        }

        // Log scoring filter results if present (from opus-scored bot)
        const scoringResults = (result as any).scoringResults;
        if (supabaseLogger && pipelineRunId && scoringResults) {
          try {
            // Log each scoring filter
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
            console.warn(`[main] Failed to log scoring filter results:`, err);
          }
        }

        // Initialize evaluation score
        let evaluationScore: number | undefined = undefined;

        // Check if note writing produced a valid correction
        if (result.noteResult.status === "SCORING_FILTERS_FAILED") {
          // Scoring filters rejected the note
          if (supabaseLogger && pipelineRunId) {
            try {
              await supabaseLogger.completePipelineRun(pipelineRunId, {
                outcome: "rejected",
                outcome_reason: "scoring_filters_failed",
                final_stage: "scoring",
                bot_id: selectedBot.id,
              });
            } catch (err) {
              console.warn(`[main] Failed to complete pipeline run:`, err);
            }
          }
        } else if (result.noteResult.status === "SOURCE_TRUST_FAILED") {
          // Source trustworthiness gate rejected the note
          if (supabaseLogger && pipelineRunId) {
            try {
              await supabaseLogger.completePipelineRun(pipelineRunId, {
                outcome: "rejected",
                outcome_reason: "source_trust_failed",
                final_stage: "source_trust",
                bot_id: selectedBot.id,
              });
            } catch (err) {
              console.warn(`[main] Failed to complete pipeline run:`, err);
            }
          }
        } else if (result.noteResult.status !== "CORRECTION WITH TRUSTWORTHY CITATION") {
          // No correction needed or couldn't find one
          if (supabaseLogger && pipelineRunId) {
            try {
              await supabaseLogger.completePipelineRun(pipelineRunId, {
                outcome: "rejected",
                outcome_reason: "no_correction_needed",
                final_stage: "note_writing",
                bot_id: selectedBot.id,
              });
            } catch (err) {
              console.warn(`[main] Failed to complete pipeline run:`, err);
            }
          }
        } else if (!checkYes) {
          // Check failed or errored
          if (supabaseLogger && pipelineRunId) {
            try {
              await supabaseLogger.completePipelineRun(pipelineRunId, {
                outcome: checkError ? "failed" : "rejected",
                outcome_reason: checkError ? "check_error" : "check_failed",
                final_stage: "check",
                bot_id: selectedBot.id,
              });
            } catch (err) {
              console.warn(`[main] Failed to complete pipeline run:`, err);
            }
          }
        } else if (shouldSubmitNotes) {
          try {
            // Evaluate note quality before submission
            const { shouldSubmitNote } = await import(
              "../filters/noteEvaluationFilter"
            );
            const noteText =
              result.noteResult.note + " " + result.noteResult.url;
            const evaluationResult = await shouldSubmitNote(
              result.post.id,
              noteText,
              0
            );

            // Capture the score for logging
            evaluationScore = evaluationResult.score;

            // Log evaluation score
            if (supabaseLogger && pipelineRunId) {
              try {
                await supabaseLogger.addPipelineScore(pipelineRunId, {
                  score_type: "evaluation",
                  score_value: evaluationResult.score,
                  score_metadata: evaluationResult.error ? { error: evaluationResult.error } : undefined,
                });
              } catch (err) {
                console.warn(`[main] Failed to log evaluation score:`, err);
              }
            }

            if (!evaluationResult.shouldSubmit) {
              console.log(
                `[main] Skipping post ${result.post.id} due to low evaluation score (score: ${evaluationResult.score}, error: ${evaluationResult.error})`
              );
              if (supabaseLogger && pipelineRunId) {
                try {
                  await supabaseLogger.completePipelineRun(pipelineRunId, {
                    outcome: "rejected",
                    outcome_reason: "low_evaluation_score",
                    final_stage: "evaluation",
                    bot_id: selectedBot.id,
                  });
                } catch (err) {
                  console.warn(`[main] Failed to complete pipeline run:`, err);
                }
              }
            } else {
              // Submit the note
              const { submitNote } = await import("../api/submitNote");
              const info = {
                classification: "misinformed_or_potentially_misleading",
                misleading_tags: ["disputed_claim_as_fact"],
                text: noteText,
                trustworthy_sources: true,
              };
              const response = await submitNote(result.post.id, info);
              console.log(
                `[main] Submitted note for post ${result.post.id} (bot: ${selectedBot.id}, score: ${evaluationResult.score}):`,
                response
              );
              submitted++;

              // Log successful submission to pipeline tracking
              const noteId = response?.data?.id;
              if (!noteId) {
                console.error(`[main] WARNING: submitNote returned success but no note ID for tweet ${result.post.id}. Response:`, JSON.stringify(response?.data));
              }
              if (supabaseLogger && pipelineRunId) {
                try {
                  await supabaseLogger.completePipelineRun(pipelineRunId, {
                    outcome: noteId ? "submitted" : "failed",
                    outcome_reason: noteId ? undefined : "no_note_id_in_response",
                    final_stage: "submission",
                    bot_id: selectedBot.id,
                    note_id: noteId,
                  });
                } catch (err) {
                  console.warn(`[main] Failed to complete pipeline run:`, err);
                }
              }

              // Also log to notes table if enabled
              if (supabaseLogger && noteId) {
                try {
                  const botConfig =
                    await supabaseLogger.getOrCreateBotConfig(selectedBot.id);
                  await supabaseLogger.logNoteSubmission({
                    note_id: response.data.id,
                    tweet_id: result.post.id,
                    bot_config_id: botConfig.id,
                    bot_name: selectedBot.id,
                    note_text: noteText,
                    source_url: result.noteResult.url,
                    evaluation_score: evaluationResult.score,
                    commit_sha: commit,
                  });
                  console.log(
                    `[main] Logged note ${response.data.id} to Supabase (bot: ${selectedBot.id})`
                  );
                } catch (supabaseErr) {
                  console.error(
                    "[main] Failed to log to Supabase:",
                    supabaseErr
                  );
                }
              }

              // Fire-and-forget: run prediction scores for later evaluation
              if (supabaseLogger && pipelineRunId) {
                const { runPredictionScores } = await import(
                  "../pipeline/predictionScores"
                );
                runPredictionScores({
                  pipelineRunId,
                  noteText,
                  sourceUrl: result.noteResult.url,
                  tweetText: content.text,
                  searchResults: result.searchContextResult.searchResults,
                  postId: result.post.id,
                  supabaseLogger,
                }).catch((err) =>
                  console.warn("[main] Prediction scores failed (non-fatal):", err)
                );
              }
            }
          } catch (err: any) {
            console.error(
              `[main] Failed to submit note for post ${result.post.id}:`,
              err.response?.data || err
            );
            // Log submission failure
            if (supabaseLogger && pipelineRunId) {
              try {
                const errorText = err.response?.data
                  ? JSON.stringify(err.response.data).slice(0, 500)
                  : (err.message || String(err)).slice(0, 500);
                await supabaseLogger.completePipelineRun(pipelineRunId, {
                  outcome: "failed",
                  outcome_reason: "submission_error",
                  error_message: errorText,
                  final_stage: "submission",
                  bot_id: selectedBot.id,
                });
              } catch (logErr) {
                console.warn(`[main] Failed to complete pipeline run:`, logErr);
              }
            }
          }
        }

      });
    }

    await queue.onIdle();
    console.log(
      `[main] All ${posts.length} posts processed with concurrency limit of ${concurrencyLimit}`
    );

    // Log bot usage summary
    console.log(`[main] Bot usage summary:`);
    Object.entries(botUsage).forEach(([botId, count]) => {
      console.log(`  - ${botId}: ${count} tweets`);
    });

    console.log(
      `[main] Successfully processed ${posts.length} posts, submitted ${submitted} notes`
    );

    // Clear the global timeout and exit successfully
    clearTimeout(globalTimeout);
    await closeBrowser();
    console.log("[main] Process completed successfully, exiting");
    process.exit(0);
  } catch (error: any) {
    console.error(
      "Error in create notes routine script:",
      error.response?.data || error
    );
    clearTimeout(globalTimeout);
    await closeBrowser();
    process.exit(1);
  }
}

main();
