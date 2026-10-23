import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DraftingAdapter, DraftResult, TweetInspection } from "../signal-bot/drafting";
import { countSubmittedNoteLength, joinNoteWithSources } from "../pipeline/utils/noteLength";
import { getWarnings, withWarnings } from "../pipeline/utils/warnings";

const HELP = `Draft notes for specific tweets locally

Usage: bun src/local/draftTweets.ts [--output-dir <directory>] <tweet-id-or-url...>

Accepts numeric tweet IDs and x.com/twitter.com tweet URLs. Duplicate IDs run once.
Uses the same research, writing, and source checks as the Signal bot.
Prints complete drafts and saves research/results as local JSON files.
Nothing is submitted to X, sent to Signal, or uploaded to a dashboard.

  --output-dir <directory>  Save results here (default: output/local-drafts/<timestamp>)
  --help, -h                Show this help without calling any services

Reads X_API_KEY, X_API_KEY_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET,
and OPENROUTER_API_KEY from the environment or normal .env files.
Media analysis also uses GEMINI_API_KEY; optional comments use XAI_API_KEY.
Research makes paid API calls. Existing result files are never overwritten.
`;

interface DraftTweetArgs {
  help: boolean;
  tweetIds: string[];
  outputDir?: string;
}

function parseTweetId(value: string): string {
  if (/^\d{1,25}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^(?:www|mobile)\./, "");
    if ((url.protocol === "https:" || url.protocol === "http:") &&
      (host === "x.com" || host === "twitter.com") && !url.username && !url.password && !url.port) {
      const match = url.pathname.match(/^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/(\d{1,25})(?:\/|$)/);
      if (match) return match[1]!;
    }
  } catch { /* Invalid URLs receive the same input error as invalid IDs. */ }
  throw new Error("Each input must be a numeric tweet ID or an X/Twitter tweet URL.");
}

export function parseDraftTweetArgs(args: string[]): DraftTweetArgs {
  if (args.includes("--help") || args.includes("-h")) return { help: true, tweetIds: [] };
  let outputDir: string | undefined;
  const tweetIds = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--output-dir") {
      const value = args[++index];
      if (!value?.trim() || value.startsWith("--") || outputDir !== undefined) {
        throw new Error("Use --output-dir once, followed by a directory.");
      }
      outputDir = value;
    } else {
      if (arg.startsWith("-")) throw new Error("Unknown option. Use --help for usage.");
      tweetIds.add(parseTweetId(arg));
    }
  }
  if (!tweetIds.size) throw new Error("Provide at least one tweet ID or URL. Use --help for usage.");
  return { help: false, tweetIds: [...tweetIds], outputDir };
}

interface DraftTweetsDependencies {
  adapter?: DraftingAdapter;
  log?: (text: string) => void;
  closeBrowser?: () => Promise<void>;
  now?: () => Date;
}

interface LocalDraftReport {
  tweetId: string;
  tweetUrl: string;
  createdAt: string;
  status: "draft" | "no_draft" | "lookup_failed" | "error";
  inspection?: TweetInspection;
  result?: DraftResult;
  noteText?: string;
  characterCount?: number;
  warnings?: string[];
  error?: string;
}

function safeWarning(message: string): string {
  // Pipeline warnings can include request URLs and raw provider error messages.
  if (message.startsWith("Image analysis:")) return "Image analysis used a fallback model.";
  if (message.startsWith("Image analysis failed")) return "An image could not be analyzed; its description is missing.";
  if (message.startsWith("Video analysis:")) return "Video analysis returned no description.";
  if (message.startsWith("Video analysis failed")) return "A video could not be analyzed; its description is missing.";
  if (message.startsWith("Media analysis failed:")) return "Media analysis failed; research may be missing media context.";
  if (message.startsWith('"Made with AI" label check failed:')) return 'The "Made with AI" label could not be checked.';
  return "The pipeline reported an additional warning; review the research and draft carefully.";
}

export async function runDraftTweets(args: string[], dependencies: DraftTweetsDependencies = {}): Promise<number> {
  const log = dependencies.log ?? console.log;
  let parsed: DraftTweetArgs;
  try { parsed = parseDraftTweetArgs(args); }
  catch (error) {
    log(error instanceof Error ? error.message : "Invalid arguments. Use --help for usage.");
    return 1;
  }
  if (parsed.help) {
    log(HELP);
    return 0;
  }

  const createdAt = (dependencies.now?.() ?? new Date()).toISOString();
  const outputDir = resolve(parsed.outputDir ?? `output/local-drafts/${createdAt.replace(/[:.]/g, "-")}`);
  try { await mkdir(outputDir, { recursive: true, mode: 0o700 }); }
  catch {
    log("Could not create the output directory. Check its path and permissions.");
    return 1;
  }
  log(`Local drafting only. Results: ${outputDir}`);
  let failed = false;
  try {
    const adapter = dependencies.adapter ?? (await import("../signal-bot/drafting")).createDraftingAdapter();
    for (const tweetId of parsed.tweetIds) {
      const tweetUrl = `https://x.com/i/web/status/${tweetId}`;
      const report: LocalDraftReport = { tweetId, tweetUrl, createdAt, status: "error" };
      log(`\n${tweetUrl}`);
      await withWarnings(async () => {
        try {
          const inspection = await adapter.inspect(tweetId);
          report.inspection = inspection;
          if (!inspection.post) {
            report.status = "lookup_failed";
            failed = true;
            log(inspection.detail.replace("Reply ‘retry’ to try the lookup again.", "Run this command again to retry."));
          } else {
            log("Tweet retrieved. Researching and checking sources…");
            const result = await adapter.draft({
              post: inspection.post,
              history: [{ role: "user", content: tweetUrl }],
            });
            report.result = result;
            report.status = result.draft ? "draft" : "no_draft";
            log(result.reply);
            if (result.draft) {
              report.noteText = joinNoteWithSources(result.draft.text, result.draft.sources);
              report.characterCount = countSubmittedNoteLength(result.draft.text, result.draft.sources);
              log(`\nDraft (${report.characterCount}/280 characters, counting each URL as one):\n${report.noteText}`);
            } else if (result.abstentionReason) {
              log(`No draft: ${result.abstentionReason}`);
            }
          }
        } catch {
          failed = true;
          report.status = "error";
          report.error = "The lookup, research, or drafting step failed. No note was submitted.";
          log(report.error);
        } finally {
          report.warnings = [...new Set(getWarnings().map(safeWarning))];
          for (const warning of report.warnings) log(`Warning: ${warning}`);
        }
      });

      const outputPath = resolve(outputDir, `${tweetId}.json`);
      try {
        await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
        log(`Saved: ${outputPath}`);
      } catch {
        failed = true;
        log(`Could not save ${tweetId}.json. Check directory permissions or choose a new output directory; existing files are preserved.`);
      }
    }
  } catch {
    failed = true;
    log("Could not initialize the drafting process. Check the local installation and environment.");
  } finally {
    try {
      const closeBrowser = dependencies.closeBrowser ?? (await import("../pipeline/utils/browserManager")).closeBrowser;
      await closeBrowser();
    } catch {
      failed = true;
      log("Browser cleanup failed.");
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.umask(0o077);
  process.exitCode = await runDraftTweets(process.argv.slice(2));
}
