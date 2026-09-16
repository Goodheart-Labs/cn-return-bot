import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Post } from "../api/fetchEligiblePosts";
import type { DraftingAdapter, DraftResult } from "../signal-bot/drafting";
import { isPublicSourceUrl } from "../signal-bot/sources";
import type { MaterialityScoreEntry, runMaterialityJudge } from "../pipeline/orchestration/materialityJudge";
import { DEFAULT_CONFIG, withBotConfig } from "../pipeline/ab-testing/botConfig";
import { MISINFO_TOPICS } from "../pipeline/misinfo-monitoring/topics";
import type { MisinfoTopicId } from "../pipeline/misinfo-monitoring/topicIds";
import { withMonitoringContext } from "../pipeline/misinfo-monitoring/monitoringContext";
import { countSubmittedNoteLength, joinNoteWithSources } from "../pipeline/utils/noteLength";
import { getWarnings, withWarnings } from "../pipeline/utils/warnings";

const SCREENING_LABEL = "uncalibrated screening score" as const;
const HELP = `Research a local batch of posts for human review

Usage: bun src/local/reviewDraftBatch.ts --input <file> [options]

Input: a JSON array of {post, origin: "chat" | "topic", topicId?, fetchedAt?}.
Supply complete Post objects; this command does not fetch tweets from X.
Topic entries use the selected topic's reference document during research.
Results include drafts, sources, research, and an uncalibrated screening score.
The score is advisory, not a probability of a Helpful rating.

  --input <file>           Local JSON input manifest (required)
  --output-dir <dir>       Default: output/draft-review-batches/<timestamp>
  --max <number>           Maximum unique posts to run (1–100, default 20)
  --concurrency <number>   Simultaneous research runs (1–8, default 3)
  --help, -h              Show help without calling any services

Uses normal environment/.env credentials without switching accounts.
Research and judging make paid API calls. Saves private local JSON files only;
never submits notes, sends Signal messages, or uploads review results.
Existing result files are preserved. Browser resources are closed on completion.
`;

export interface ReviewDraftBatchInput {
  post: Post;
  topicId?: MisinfoTopicId;
  origin: "chat" | "topic";
  fetchedAt?: string;
}

export interface ReviewDraftBatchResult {
  tweetId: string;
  tweetUrl: string;
  createdAt: string;
  completedAt?: string;
  input: ReviewDraftBatchInput;
  provenance: ReviewDraftBatchInput[];
  status: "draft" | "no_draft" | "error";
  result?: DraftResult;
  noteText?: string;
  characterCount?: number;
  screening?: {
    label: typeof SCREENING_LABEL;
    scores: MaterialityScoreEntry[];
    score?: number;
    reason?: string;
    error?: string;
  };
  warnings: string[];
  error?: string;
  saveError?: string;
}

export interface ReviewDraftBatchManifest {
  schemaVersion: 1;
  createdAt: string;
  completedAt?: string;
  inputPath: string;
  total: number;
  completed: number;
  status: "running" | "complete" | "error";
  results: ReviewDraftBatchResult[];
}

interface BatchArgs {
  help: boolean;
  inputPath?: string;
  outputDir?: string;
  max: number;
  concurrency: number;
}

export function parseReviewDraftBatchArgs(args: string[]): BatchArgs {
  if (args.includes("--help") || args.includes("-h")) return { help: true, max: 20, concurrency: 3 };
  const parsed: BatchArgs = { help: false, max: 20, concurrency: 3 };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!;
    if (!["--input", "--output-dir", "--max", "--concurrency"].includes(key)) {
      throw new Error("Unknown option. Use --help for usage.");
    }
    const value = args[++index];
    if (!value?.trim() || value.startsWith("--") || seen.has(key)) {
      throw new Error("Each option must appear once and have a value. Use --help for usage.");
    }
    seen.add(key);
    if (key === "--input") parsed.inputPath = resolve(value);
    else if (key === "--output-dir") parsed.outputDir = resolve(value);
    else {
      const limit = key === "--max" ? 100 : 8;
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > limit) {
        throw new Error(`${key} must be an integer between 1 and ${limit}.`);
      }
      if (key === "--max") parsed.max = Number(value);
      else parsed.concurrency = Number(value);
    }
  }
  if (!parsed.inputPath) throw new Error("Provide --input with a JSON manifest. Use --help for usage.");
  return parsed;
}

function validMediaUrl(value: unknown): boolean {
  return typeof value === "string" && !/[\s\u0000-\u001f\u007f]/.test(value) && isPublicSourceUrl(value);
}

function validMedia(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((media) => {
    if (!media || typeof media !== "object" || !["photo", "video", "animated_gif"].includes(media.type)) return false;
    for (const key of ["url", "preview_image_url"]) if (media[key] !== undefined && !validMediaUrl(media[key])) return false;
    if (media.duration_ms !== undefined && (typeof media.duration_ms !== "number" || !Number.isFinite(media.duration_ms) || media.duration_ms < 0)) return false;
    if (media.variants !== undefined && (!Array.isArray(media.variants) || !media.variants.every((variant: unknown) => {
      if (!variant || typeof variant !== "object") return false;
      const item = variant as Record<string, unknown>;
      return validMediaUrl(item.url) && typeof item.content_type === "string" &&
        (item.bit_rate === undefined || (typeof item.bit_rate === "number" && Number.isFinite(item.bit_rate) && item.bit_rate >= 0));
    }))) return false;
    return media.url !== undefined || media.preview_image_url !== undefined || Boolean(media.variants?.length);
  });
}

function validPostFields(post: unknown, requireMedia: boolean): boolean {
  if (!post || typeof post !== "object") return false;
  const value = post as Record<string, unknown>;
  return typeof value.id === "string" && /^\d{1,25}$/.test(value.id) &&
    typeof value.author_id === "string" && /^\d{1,25}$/.test(value.author_id) &&
    typeof value.text === "string" && Boolean(value.text.trim()) &&
    typeof value.created_at === "string" && Number.isFinite(Date.parse(value.created_at)) &&
    ((!requireMedia && value.media === undefined) || validMedia(value.media));
}

export function parseReviewDraftBatchInput(value: unknown): ReviewDraftBatchInput[] {
  if (!Array.isArray(value) || !value.length) throw new Error("The input must be a nonempty JSON array.");
  const topicIds = new Set<string>(MISINFO_TOPICS.map((topic) => topic.id));
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || !["chat", "topic"].includes(entry.origin)) {
      throw new Error("Every input must have origin 'chat' or 'topic'.");
    }
    if ((entry.topicId !== undefined && !topicIds.has(entry.topicId)) ||
      (entry.origin === "topic" && entry.topicId === undefined)) {
      throw new Error("Topic inputs require a known topicId; any supplied topicId must be known.");
    }
    const post = entry.post;
    if (!validPostFields(post, true) ||
      (post.referenced_tweet_data !== undefined && !validPostFields(post.referenced_tweet_data, false))) {
      throw new Error("Posts and referenced posts need numeric string IDs, nonempty text, valid created_at dates, and valid media with public HTTP(S) URLs. Local media files are not accepted.");
    }
    if ((post.entities !== undefined && (!Array.isArray(post.entities) || post.entities.some((entity: unknown) => typeof entity !== "string"))) ||
      (post.referenced_tweets !== undefined && (!Array.isArray(post.referenced_tweets) || post.referenced_tweets.some((reference: unknown) => {
        if (!reference || typeof reference !== "object") return true;
        const item = reference as Record<string, unknown>;
        return typeof item.id !== "string" || !/^\d{1,25}$/.test(item.id) || !["retweeted", "quoted", "replied_to"].includes(String(item.type));
      })))) {
      throw new Error("Post entities and references must have their expected string fields.");
    }
    for (const key of ["author_name", "author_description"]) {
      if (post[key] !== undefined && typeof post[key] !== "string") throw new Error("Optional author name and description must be strings.");
    }
    const counts = [post.author_followers, post.author_tweet_count];
    if (post.public_metrics !== undefined) {
      if (!post.public_metrics || typeof post.public_metrics !== "object" || Array.isArray(post.public_metrics)) throw new Error("Post metrics must be an object of nonnegative counts.");
      counts.push(...Object.values(post.public_metrics));
    }
    if (counts.some((count) => count !== undefined && (typeof count !== "number" || !Number.isFinite(count) || count < 0))) {
      throw new Error("Post metrics and author counts must be nonnegative finite numbers.");
    }
    if (entry.fetchedAt !== undefined && (typeof entry.fetchedAt !== "string" || !Number.isFinite(Date.parse(entry.fetchedAt)))) {
      throw new Error("Any fetchedAt value must be a valid date string.");
    }
  }
  return value as ReviewDraftBatchInput[];
}

interface BatchDependencies {
  adapter?: Pick<DraftingAdapter, "draft">;
  judge?: typeof runMaterialityJudge;
  log?: (text: string) => void;
  closeBrowser?: () => Promise<void>;
  now?: () => Date;
}

function safeWarning(message: string): string {
  if (message.startsWith("Image analysis:")) return "Image analysis used a fallback model.";
  if (message.startsWith("Image analysis failed")) return "An image could not be analyzed; its description is missing.";
  if (message.startsWith("Video analysis:")) return "Video analysis returned no description.";
  if (message.startsWith("Video analysis failed")) return "A video could not be analyzed; its description is missing.";
  if (message.startsWith("Media analysis failed:")) return "Media analysis failed; research may be missing media context.";
  if (message.startsWith('"Made with AI" label check failed:')) return 'The "Made with AI" label could not be checked.';
  return "The pipeline reported an additional warning; review the research and draft carefully.";
}

function json(value: unknown): string { return JSON.stringify(value, null, 2) + "\n"; }

export async function runReviewDraftBatch(args: string[], dependencies: BatchDependencies = {}): Promise<number> {
  const log = dependencies.log ?? console.log;
  const now = () => (dependencies.now?.() ?? new Date()).toISOString();
  let parsed: BatchArgs;
  try { parsed = parseReviewDraftBatchArgs(args); }
  catch (error) {
    log(error instanceof Error ? error.message : "Invalid arguments. Use --help for usage.");
    return 1;
  }
  if (parsed.help) { log(HELP); return 0; }
  let raw: unknown;
  try { raw = JSON.parse(await readFile(parsed.inputPath!, "utf8")); }
  catch { log("Could not read the input JSON manifest. Check its path, permissions, and JSON syntax."); return 1; }
  let inputs: ReviewDraftBatchInput[];
  try { inputs = parseReviewDraftBatchInput(raw); }
  catch (error) { log((error as Error).message); return 1; }

  const unique = new Map<string, ReviewDraftBatchInput[]>();
  for (const input of inputs) {
    const prior = unique.get(input.post.id);
    if (prior) prior.push(input);
    else unique.set(input.post.id, [input]);
  }
  const selected = [...unique.values()].slice(0, parsed.max);
  const createdAt = now();
  const outputDir = resolve(parsed.outputDir ?? `output/draft-review-batches/${createdAt.replace(/[:.]/g, "-")}`);
  const manifestPath = resolve(outputDir, "results.json");
  const manifest: ReviewDraftBatchManifest = {
    schemaVersion: 1, createdAt, inputPath: parsed.inputPath!, total: selected.length,
    completed: 0, status: "running", results: [],
  };
  try {
    await mkdir(outputDir, { recursive: true, mode: 0o700 });
    if ((await stat(outputDir)).mode & 0o077) throw new Error("Output directory is not private.");
    for (const provenance of selected) {
      try { await stat(resolve(outputDir, `${provenance[0]!.post.id}.json`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      throw new Error("A result file already exists.");
    }
    await writeFile(manifestPath, json(manifest), { mode: 0o600, flag: "wx" });
  } catch {
    log("Could not initialize private result files. Choose a new output directory, or an empty directory accessible only by its owner. Existing results are preserved.");
    return 1;
  }
  log(`Drafting ${selected.length} unique posts with concurrency ${parsed.concurrency}. Results: ${outputDir}`);
  log("Screening scores are uncalibrated and are not probabilities of Helpful ratings. No notes will be submitted.");
  let failed = false;
  const results: Array<ReviewDraftBatchResult | undefined> = new Array(selected.length);
  let saveQueue = Promise.resolve();
  const saveManifest = (): Promise<void> => {
    saveQueue = saveQueue.then(async () => {
      manifest.results = results.filter((result): result is ReviewDraftBatchResult => result !== undefined);
      manifest.completed = manifest.results.length;
      const temporary = resolve(outputDir, `.results-${randomUUID()}.json.tmp`);
      try {
        await writeFile(temporary, json(manifest), { mode: 0o600, flag: "wx" });
        await rename(temporary, manifestPath);
      } catch { failed = true; log("Could not update results.json; completed per-tweet files remain available."); }
    });
    return saveQueue;
  };
  try {
    const adapter = dependencies.adapter ?? (await import("../signal-bot/drafting")).createDraftingAdapter();
    const judge = dependencies.judge ?? (await import("../pipeline/orchestration/materialityJudge")).runMaterialityJudge;
    let next = 0;
    const worker = async () => {
      while (next < selected.length) {
        const index = next++;
        const provenance = selected[index]!;
        const input = provenance[0]!;
        const report: ReviewDraftBatchResult = {
          tweetId: input.post.id, tweetUrl: `https://x.com/i/web/status/${input.post.id}`,
          createdAt: now(), input, provenance, status: "error", warnings: [],
        };
        const topic = input.topicId ? MISINFO_TOPICS.find((topic) => topic.id === input.topicId)! : undefined;
        log(`Researching ${report.tweetUrl} (${input.origin}${topic ? `: ${topic.title}` : ""})`);
        await withWarnings(async () => {
          try {
            const result = await withMonitoringContext(topic ? {
              topicId: topic.id, topicTitle: topic.title, document: topic.document, documentUrl: topic.documentUrl,
            } : undefined, () => adapter.draft({ post: input.post, history: [{ role: "user", content: report.tweetUrl }] }));
            report.result = result;
            report.status = result.draft ? "draft" : "no_draft";
            if (result.draft) {
              report.noteText = joinNoteWithSources(result.draft.text, result.draft.sources);
              report.characterCount = countSubmittedNoteLength(result.draft.text, result.draft.sources);
              report.screening = { label: SCREENING_LABEL, scores: [] };
              try {
                const scores = await withBotConfig({
                  ...DEFAULT_CONFIG, botId: "simple-bot", author_history: false,
                  web_search: "native", search_model: "anthropic/claude-sonnet-4.6",
                }, () => judge({ postText: input.post.text, findings: result.research ?? "", noteText: report.noteText! }));
                const overall = scores.find((score) => score.type === "materiality_overall");
                if (!overall || !Number.isFinite(overall.value) || overall.value < 0 || overall.value > 1 || typeof overall.metadata.why !== "string") {
                  throw new Error("Invalid screening response.");
                }
                report.screening.scores = scores;
                report.screening.score = overall.value;
                report.screening.reason = overall.metadata.why;
              } catch {
                report.screening.error = "The advisory screening judge failed. The draft and research are still available for review.";
                report.warnings.push(report.screening.error);
              }
              log(`Draft ${report.tweetId} (${report.characterCount}/280):\n${report.noteText}\nScreening: ${report.screening.score ?? "unavailable"} — ${SCREENING_LABEL}`);
            } else log(`No draft for ${report.tweetId}: ${result.abstentionReason ?? result.reply}`);
          } catch {
            failed = true;
            report.status = "error";
            report.error = "Research or drafting failed. No note was submitted.";
            log(`${report.tweetId}: ${report.error}`);
          } finally {
            report.warnings = [...new Set([...report.warnings, ...getWarnings().map(safeWarning)])];
            report.completedAt = now();
          }
        });
        try { await writeFile(resolve(outputDir, `${report.tweetId}.json`), json(report), { mode: 0o600, flag: "wx" }); }
        catch {
          failed = true;
          report.saveError = "Could not save this per-tweet result. Check results.json and directory permissions.";
          log(`${report.tweetId}: ${report.saveError}`);
        }
        results[index] = report;
        await saveManifest();
      }
    };
    await Promise.all(Array.from({ length: Math.min(parsed.concurrency, selected.length) }, worker));
  } catch {
    failed = true;
    log("Could not initialize or complete the drafting batch. Check the local installation and environment.");
  } finally {
    try { await (dependencies.closeBrowser ?? (await import("../pipeline/utils/browserManager")).closeBrowser)(); }
    catch { failed = true; log("Browser cleanup failed."); }
    manifest.status = failed ? "error" : "complete";
    manifest.completedAt = now();
    await saveManifest();
  }
  log(`Finished ${manifest.completed}/${manifest.total}. Results: ${manifestPath}`);
  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.umask(0o077);
  process.exitCode = await runReviewDraftBatch(process.argv.slice(2));
}
