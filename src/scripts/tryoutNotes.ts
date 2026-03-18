/**
 * Tryout Notes
 *
 * Run the production pipeline on specific tweet IDs without submitting.
 * Results are written to a local Supabase and a CSV file.
 *
 * Usage:
 *   bun run src/scripts/tryoutNotes.ts <tweet-id> [<tweet-id> ...]
 *   bun run src/scripts/tryoutNotes.ts --skip-existing <tweet-id> <tweet-id>
 */

import "dotenv/config";

// Route Supabase to local instance (must happen before any Supabase imports)
const localUrl = process.env.LOCAL_SUPABASE_URL;
const localKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (localUrl && localKey) {
  process.env.SUPABASE_URL = localUrl;
  process.env.SUPABASE_SERVICE_KEY = localKey;
}

import { SupabaseLogger } from "../api/supabaseClient";
import { fetchTweetById } from "../api/fetchTweetById";
import { selectRandomBot } from "../bots";
import { processSingleTweet, type ProcessTweetResult } from "../pipeline/processTweet";
import { closeBrowser } from "../pipeline/browserManager";
import { createTweetLog, withTweetLog, formatTweetLog, formatTweetLogFull } from "../pipeline/tweetLog";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(): { tweetIds: string[]; skipExisting: boolean } {
  const args = process.argv.slice(2);
  const skipExisting = args.includes("--skip-existing");
  const tweetIds = args
    .filter((a) => !a.startsWith("--"))
    .map(extractTweetId)
    .filter(Boolean) as string[];

  if (tweetIds.length === 0) {
    console.error("Usage: bun run src/scripts/tryoutNotes.ts [--skip-existing] <tweet-id> [<tweet-id> ...]");
    process.exit(1);
  }

  return { tweetIds, skipExisting };
}

function extractTweetId(input: string): string | null {
  // Handle full URLs like https://x.com/user/status/123456
  const urlMatch = input.match(/status\/(\d+)/);
  if (urlMatch) return urlMatch[1]!;

  // Handle bare numeric IDs
  if (/^\d+$/.test(input)) return input;

  console.warn(`[tryout] Skipping invalid tweet ID: ${input}`);
  return null;
}

// ---------------------------------------------------------------------------
// Skip-existing check
// ---------------------------------------------------------------------------

async function filterExistingTweets(
  logger: SupabaseLogger | null,
  tweetIds: string[]
): Promise<string[]> {
  if (!logger) return tweetIds;

  try {
    const existing = await logger.fetchAllRows<{ tweet_id: string }>(
      (client) => client.from("pipeline_runs").select("tweet_id").in("tweet_id", tweetIds)
    );
    const existingSet = new Set(existing.map((r) => r.tweet_id));
    const filtered = tweetIds.filter((id) => !existingSet.has(id));
    const skipped = tweetIds.length - filtered.length;
    if (skipped > 0) {
      console.log(`[tryout] Skipping ${skipped} tweet(s) already in DB`);
    }
    return filtered;
  } catch (err) {
    console.warn("[tryout] Failed to check existing tweets, processing all:", err);
    return tweetIds;
  }
}

// ---------------------------------------------------------------------------
// CSV output
// ---------------------------------------------------------------------------

const CSV_HEADERS = [
  "tweet_url",
  "tweet_text",
  "bot_id",
  "outcome",
  "note_text",
  "source_verification",
  "evaluation_score",
  "search_results",
  "citations",
] as const;

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function resultToCsvRow(tweetId: string, botId: string, result: ProcessTweetResult): string {
  const pr = result.pipelineResult;
  const svScore = result.scores.find((s) => s.type === "source_verification");
  const citations = pr?.searchContextResult?.citations?.join("; ") ?? "";

  const fields: Record<(typeof CSV_HEADERS)[number], string> = {
    tweet_url: `https://x.com/i/status/${tweetId}`,
    tweet_text: pr?.post?.text ?? "",
    bot_id: botId,
    outcome: `${result.outcome}${result.outcomeReason ? ` (${result.outcomeReason})` : ""}`,
    note_text: result.noteText ?? "",
    source_verification: svScore?.label ?? (svScore ? String(svScore.value) : "skipped"),
    evaluation_score: result.evaluationScore?.toFixed(2) ?? "",
    search_results: pr?.searchContextResult?.searchResults ?? "",
    citations,
  };

  return CSV_HEADERS.map((h) => escapeCsvField(fields[h])).join(",");
}

function writeCsv(rows: string[]): string {
  const outDir = path.join(process.cwd(), "tryout-results");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15);
  const outFile = path.join(outDir, `${timestamp}.csv`);

  const content = [CSV_HEADERS.join(","), ...rows].join("\n");
  fs.writeFileSync(outFile, content, "utf8");
  return outFile;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { tweetIds, skipExisting } = parseArgs();

  // Initialize logger (optional — works without local Supabase)
  let logger: SupabaseLogger | null = null;
  try {
    logger = new SupabaseLogger();
    console.log(`[tryout] Connected to Supabase at ${process.env.SUPABASE_URL}`);
  } catch {
    console.log("[tryout] No Supabase configured — running without DB logging");
  }

  // Filter existing if requested
  let idsToProcess = tweetIds;
  if (skipExisting && logger) {
    idsToProcess = await filterExistingTweets(logger, tweetIds);
  }

  if (idsToProcess.length === 0) {
    console.log("[tryout] No tweets to process.");
    return;
  }

  console.log(`[tryout] Processing ${idsToProcess.length} tweet(s)...\n`);

  const csvRows: string[] = [];

  for (const [idx, tweetId] of idsToProcess.entries()) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[tryout] Tweet ${idx + 1}/${idsToProcess.length}: ${tweetId}`);
    console.log("=".repeat(60));

    try {
      // Fetch tweet
      const post = await fetchTweetById(tweetId);

      // Select bot and run pipeline
      const bot = selectRandomBot();
      const log = createTweetLog();
      log.set("tweet.index", idx + 1);
      log.set("tweet.total", idsToProcess.length);
      const result = await withTweetLog(log, () =>
        processSingleTweet({ post, bot, logger })
      );

      console.log(formatTweetLog(log));
      console.log(formatTweetLogFull(log));

      csvRows.push(resultToCsvRow(tweetId, bot.id, result));
    } catch (err: any) {
      console.error(`[tryout] Failed to process tweet ${tweetId}:`, err?.message);
      csvRows.push(
        CSV_HEADERS.map((h) =>
          escapeCsvField(
            h === "tweet_url" ? `https://x.com/i/status/${tweetId}` :
            h === "outcome" ? `error: ${err?.message ?? "unknown"}` : ""
          )
        ).join(",")
      );
    }
  }

  // Write CSV
  const csvFile = writeCsv(csvRows);
  console.log(`\n[tryout] Results written to ${csvFile}`);

  // Cleanup
  try {
    await closeBrowser();
  } catch {}
}

main().catch((err) => {
  console.error("[tryout] Fatal error:", err);
  process.exit(1);
});
