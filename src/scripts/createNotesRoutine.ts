import { fetchEligiblePosts } from "../api/fetchEligiblePosts";
import { AirtableLogger, createLogEntry } from "../api/airtableLogger";
import { SupabaseLogger } from "../api/supabaseClient";
import { getOriginalTweetContent } from "../utils/retweetUtils";
import PQueue from "p-queue";
import {
  selectRandomBot,
  getBotProbabilities,
  getEnabledBots,
  Bot,
  PipelineResult,
} from "../bots";

const maxPosts = 10; // Maximum posts to process per run
const concurrencyLimit = 3; // Process 3 posts at a time to avoid rate limiting
const MAX_RUNTIME_MS = 5 * 60 * 1000; // 5 minutes maximum runtime
const MAX_BOT_RETRIES = 3; // Maximum retries with different bots

// Global timeout to prevent hanging
const globalTimeout = setTimeout(() => {
  console.log("[main] Maximum runtime reached (5 minutes), forcing exit");
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

    // Initialize Airtable logger
    const airtableLogger = new AirtableLogger();
    const logEntries: any[] = [];

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

    // Get existing URLs from Airtable (check all bots)
    const existingUrls = await airtableLogger.getExistingUrls();

    // Convert URLs to post IDs (extract ID from URL)
    const skipPostIds = new Set<string>();
    existingUrls.forEach((url) => {
      const match = url.match(/status\/(\d+)$/);
      if (match && match[1]) skipPostIds.add(match[1]);
    });

    console.log(`[main] Skipping ${skipPostIds.size} already-processed posts`);

    let posts = await fetchEligiblePosts(maxPosts, skipPostIds, 3);

    if (!posts.length) {
      console.log("No new eligible posts found.");
      clearTimeout(globalTimeout);
      process.exit(0);
    }
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

        console.log(
          `[main] Processing post #${idx + 1} (ID: ${post.id}) - ${
            content.isRetweet ? "retweet" : "original"
          }`
        );

        // Try bots until one succeeds or we run out of retries
        let result: PipelineResult | null = null;
        let selectedBot: Bot | null = null;
        const triedBots = new Set<string>();
        const enabledBots = getEnabledBots();

        for (
          let attempt = 0;
          attempt < MAX_BOT_RETRIES && attempt < enabledBots.length;
          attempt++
        ) {
          // Select a random bot, excluding already tried ones
          let bot = selectRandomBot();
          let retryCount = 0;
          while (triedBots.has(bot.id) && retryCount < 10) {
            bot = selectRandomBot();
            retryCount++;
          }

          if (triedBots.has(bot.id)) {
            // All bots tried, find one we haven't tried
            const untried = enabledBots.find((b) => !triedBots.has(b.id));
            if (!untried) break;
            bot = untried;
          }

          triedBots.add(bot.id);
          selectedBot = bot;
          console.log(
            `[main] Tweet ${post.id} attempt ${attempt + 1} with bot: ${bot.id}`
          );
          botUsage[bot.id] = (botUsage[bot.id] || 0) + 1;

          // Run the bot's pipeline
          result = await bot.runPipeline(post, content);
          if (result) break; // Success, exit retry loop

          console.log(
            `[main] Bot ${bot.id} failed for post ${post.id}, trying another bot...`
          );
        }

        if (!result || !selectedBot) return;

        // Check if the source verification passed
        const checkYes =
          result.checkResult &&
          result.checkResult.trim().toUpperCase() === "YES";

        // Initialize evaluation score
        let evaluationScore: number | undefined = undefined;

        if (
          result.noteResult.status === "CORRECTION WITH TRUSTWORTHY CITATION" &&
          checkYes
        ) {
          if (shouldSubmitNotes) {
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

              if (!evaluationResult.shouldSubmit) {
                console.log(
                  `[main] Skipping post ${result.post.id} due to low evaluation score (score: ${evaluationResult.score}, error: ${evaluationResult.error})`
                );
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

                // Log to Supabase if enabled
                if (supabaseLogger && response?.data?.id) {
                  try {
                    const botConfig =
                      await supabaseLogger.getOrCreateBotConfig(selectedBot.id);
                    await supabaseLogger.logNoteSubmission({
                      note_id: response.data.id,
                      tweet_id: result.post.id,
                      bot_config_id: botConfig.id,
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
              }
            } catch (err: any) {
              console.error(
                `[main] Failed to submit note for post ${result.post.id}:`,
                err.response?.data || err
              );
            }
          }
        }

        // Create log entry for this result
        const logEntry = createLogEntry(
          result.post,
          result.searchContextResult,
          result.noteResult,
          result.checkResult,
          selectedBot.id,
          commit,
          evaluationScore
        );
        logEntries.push(logEntry);
      });
    }

    await queue.onIdle();
    console.log(
      `[main] All ${posts.length} posts processed with concurrency limit of ${concurrencyLimit}`
    );

    // Log all entries to Airtable
    if (logEntries.length > 0) {
      try {
        await airtableLogger.logMultipleEntries(logEntries);
        console.log(
          `[main] Successfully logged ${logEntries.length} entries to Airtable`
        );
      } catch (err) {
        console.error("[main] Failed to log to Airtable:", err);
      }
    }

    // Log bot usage summary
    console.log(`[main] Bot usage summary:`);
    Object.entries(botUsage).forEach(([botId, count]) => {
      console.log(`  - ${botId}: ${count} tweets`);
    });

    if (logEntries.length === 0) {
      console.log(
        "No posts with status 'CORRECTION WITH TRUSTWORTHY CITATION' found."
      );
    } else {
      console.log(
        `[main] Successfully processed ${logEntries.length} posts, submitted ${submitted} notes`
      );
    }

    // Clear the global timeout and exit successfully
    clearTimeout(globalTimeout);
    console.log("[main] Process completed successfully, exiting");
    process.exit(0);
  } catch (error: any) {
    console.error(
      "Error in create notes routine script:",
      error.response?.data || error
    );
    clearTimeout(globalTimeout);
    process.exit(1);
  }
}

main();
