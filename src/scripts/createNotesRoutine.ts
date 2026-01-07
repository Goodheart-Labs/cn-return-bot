import { fetchEligiblePosts } from "../api/fetchEligiblePosts";
import { versionOneFn as searchV1 } from "../pipeline/searchContextGoal";
import { writeNoteWithSearchFn as writeV1 } from "../pipeline/writeNoteWithSearchGoal";
import { multiSourceSearch } from "../pipeline/multiSourceSearch";
import { check as checkV1 } from "../pipeline/check";
import { AirtableLogger, createLogEntry } from "../api/airtableLogger";
import { SupabaseLogger } from "../api/supabaseClient";
import { getOriginalTweetContent } from "../utils/retweetUtils";
import PQueue from "p-queue";
import {
  selectRandomBot,
  getBotProbabilities,
  getEnabledBots,
  BotConfig,
} from "../lib/botConfig";

const maxPosts = 10; // Maximum posts to process per run
const concurrencyLimit = 3; // Process 3 posts at a time to avoid rate limiting
const MAX_RUNTIME_MS = 5 * 60 * 1000; // 5 minutes maximum runtime
const MAX_BOT_RETRIES = 3; // Maximum retries with different bots

// Global timeout to prevent hanging
const globalTimeout = setTimeout(() => {
  console.log("[main] Maximum runtime reached (5 minutes), forcing exit");
  process.exit(0);
}, MAX_RUNTIME_MS);

async function runPipeline(post: any, idx: number, bot: BotConfig) {
  console.log(
    `[runPipeline] Starting pipeline for post #${idx + 1} (ID: ${post.id}) with bot: ${bot.id}`
  );
  try {
    // Get the original tweet content (handling retweets)
    const originalContent = getOriginalTweetContent(post);

    console.log(
      `[runPipeline] Processing ${
        originalContent.isRetweet ? "retweet" : "original tweet"
      } for post #${idx + 1}`
    );

    // Use different search strategy based on bot config
    let searchContextResult: {
      text: string;
      searchResults: string;
      citations?: string[];
      retweetContext?: string;
    };

    if (bot.searchStrategy === "multi-source") {
      console.log(`[runPipeline] Using multi-source search for bot: ${bot.id}`);
      searchContextResult = await multiSourceSearch({
        text: originalContent.text,
        media: originalContent.media,
        retweetContext: originalContent.retweetContext,
      });
    } else {
      // Default: use Perplexity search
      searchContextResult = await searchV1(
        {
          text: originalContent.text,
          media: originalContent.media,
          searchResults: "",
          retweetContext: originalContent.retweetContext,
        },
        { model: bot.searchModel || "perplexity/sonar" }
      );
    }
    console.log(
      `[runPipeline] Search context complete for post #${idx + 1} (ID: ${
        post.id
      })`
    );

    // Use bot's note model
    const noteResult = await writeV1(
      {
        text: searchContextResult.text,
        searchResults: searchContextResult.searchResults,
        citations: searchContextResult.citations || [],
      },
      { model: bot.noteModel }
    );
    console.log(
      `[runPipeline] Note generated for post #${idx + 1} (ID: ${post.id}) using ${bot.noteModel}`
    );

    const checkResult = await checkV1({
      note: noteResult.note,
      url: noteResult.url,
      status: noteResult.status,
    });
    console.log(
      `[runPipeline] Check complete for post #${idx + 1} (ID: ${post.id})`
    );

    return {
      post,
      botId: bot.id,
      searchContextResult,
      noteResult,
      checkResult,
    };
  } catch (err) {
    console.error(
      `[runPipeline] Error in pipeline for post #${idx + 1} (ID: ${post.id}) with bot ${bot.id}:`,
      err
    );
    return null;
  }
}

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

    console.log(
      `[main] Skipping ${skipPostIds.size} already-processed posts`
    );

    let posts = await fetchEligiblePosts(maxPosts, skipPostIds, 3); // Fetch up to 3 pages to get at least 10 posts

    if (!posts.length) {
      console.log("No new eligible posts found.");
      clearTimeout(globalTimeout);
      process.exit(0);
    }
    console.log(`[main] Starting pipelines for ${posts.length} posts...`);

    const queue = new PQueue({ concurrency: concurrencyLimit });
    const results: any[] = [];
    let submitted = 0;

    // Add progress logging
    queue.on("active", () => {
      console.log(`[queue] Task started - ${queue.size} remaining in queue`);
    });

    // Add all tasks to the queue
    for (const [idx, post] of posts.entries()) {
      queue.add(async () => {
        // Try bots until one succeeds or we run out of retries
        let r: Awaited<ReturnType<typeof runPipeline>> = null;
        let selectedBot: BotConfig | null = null;
        const triedBots = new Set<string>();
        const enabledBots = getEnabledBots();

        for (let attempt = 0; attempt < MAX_BOT_RETRIES && attempt < enabledBots.length; attempt++) {
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
          console.log(`[main] Tweet ${post.id} attempt ${attempt + 1} with bot: ${bot.id}`);
          botUsage[bot.id] = (botUsage[bot.id] || 0) + 1;

          r = await runPipeline(post, idx, bot);
          if (r) break; // Success, exit retry loop

          console.log(`[main] Bot ${bot.id} failed for post ${post.id}, trying another bot...`);
        }

        if (!r || !selectedBot) return;

        // Check if the source verification passed
        const checkYes =
          r.checkResult && r.checkResult.trim().toUpperCase() === "YES";

        // Initialize evaluation score
        let evaluationScore: number | undefined = undefined;

        if (
          r.noteResult.status === "CORRECTION WITH TRUSTWORTHY CITATION" &&
          checkYes
        ) {
          if (shouldSubmitNotes) {
            try {
              // Evaluate note quality before submission
              const { shouldSubmitNote } = await import("../filters/noteEvaluationFilter");
              const noteText = r.noteResult.note + " " + r.noteResult.url;
              const evaluationResult = await shouldSubmitNote(r.post.id, noteText, 0); // Production threshold: only submit scores >= 0

              // Capture the score for logging
              evaluationScore = evaluationResult.score;

              if (!evaluationResult.shouldSubmit) {
                console.log(
                  `[main] Skipping post ${r.post.id} due to low evaluation score (score: ${evaluationResult.score}, error: ${evaluationResult.error})`
                );
              } else {
                // Submit the note using the same info as in your submitNote.ts
                const { submitNote } = await import("../api/submitNote");
                const info = {
                  classification: "misinformed_or_potentially_misleading",
                  misleading_tags: ["disputed_claim_as_fact"],
                  text: noteText,
                  trustworthy_sources: true,
                };
                const response = await submitNote(r.post.id, info);
                console.log(
                  `[main] Submitted note for post ${r.post.id} (bot: ${selectedBot.id}, score: ${evaluationResult.score}):`,
                  response
                );
                submitted++;

                // Log to Supabase if enabled
                if (supabaseLogger && response?.data?.id) {
                  try {
                    // Get or create bot config in Supabase
                    const botConfig = await supabaseLogger.getOrCreateBotConfig(selectedBot.id);
                    await supabaseLogger.logNoteSubmission({
                      note_id: response.data.id,
                      tweet_id: r.post.id,
                      bot_config_id: botConfig.id,
                      note_text: noteText,
                      source_url: r.noteResult.url,
                      evaluation_score: evaluationResult.score,
                      commit_sha: commit,
                    });
                    console.log(`[main] Logged note ${response.data.id} to Supabase (bot: ${selectedBot.id})`);
                  } catch (supabaseErr) {
                    console.error("[main] Failed to log to Supabase:", supabaseErr);
                  }
                }
              }
            } catch (err: any) {
              console.error(
                `[main] Failed to submit note for post ${r.post.id}:`,
                err.response?.data || err
              );
            }
          }
        }

        // Create log entry for this result (now including the evaluation score and bot ID)
        const logEntry = createLogEntry(
          r.post,
          r.searchContextResult,
          r.noteResult,
          r.checkResult,
          selectedBot.id,
          commit,
          evaluationScore
        );
        logEntries.push(logEntry);
      });
    }

    await queue.onIdle(); // Wait for all tasks to complete
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
    // Clear the global timeout and exit with error
    clearTimeout(globalTimeout);
    process.exit(1);
  }
}

main();
