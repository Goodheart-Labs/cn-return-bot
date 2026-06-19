/**
 * Check YouTube Claims
 *
 * Point the note pipeline at a YouTube video. Two decoupled stages:
 *
 *   1. EXTRACT  — pull a timestamped transcript for a minute range, then ask
 *      Opus (high thinking) to extract every checkable claim in neutral,
 *      self-contained language (including implicit ones) and tag each with a
 *      7-point truth judgement from its own knowledge. Writes claims.json.
 *
 *   2. CHECK    — run each claim through simple-bot + the note-needed prefilter
 *      to decide whether it needs a correction and what that correction is.
 *      Writes results.json, a dashboard CSV, and prints a per-claim summary.
 *
 * Claim extraction is the part worth iterating on, so it round-trips through
 * claims.json: extract once, then re-run the pipeline with --claims as often
 * as you like.
 *
 * Usage:
 *   # extract + check (minutes 0–10)
 *   bun run src/local/checkYoutubeClaims.ts --url https://youtu.be/Jj-kBHzUohs --begin 0 --end 10
 *   # iterate on extraction only (no pipeline cost)
 *   bun run src/local/checkYoutubeClaims.ts --url https://youtu.be/Jj-kBHzUohs --end 5 --extract-only
 *   # re-run the pipeline on a saved claims.json
 *   bun run src/local/checkYoutubeClaims.ts --claims dataset_runs/.../claims.json
 *
 * Flags:
 *   --url <youtube-url>     required unless --claims
 *   --begin <minutes>       default 0
 *   --end <minutes>         default: end of video
 *   --lang <code>           transcript language (default en)
 *   --transcript-file <p>   extract+check a local transcript .txt (no timestamps/links)
 *   --claims <file.json>    skip extraction, check these claims
 *   --extract-only          stop after extraction (write claims.json only)
 *   --transcript-only       just dump the transcript to transcript.txt (no LLM)
 *   --concurrency <n>       parallel pipeline workers (default 5)
 *   --name <label>          dashboard run label
 *   --no-dashboard          skip the dashboard upload (JSON output only)
 *
 * Every run that fetches a transcript also writes transcript.txt (timestamped)
 * into its output folder.
 */

import "dotenv/config";
import { captureProdSupabaseCreds } from "./prodSupabaseCreds";
captureProdSupabaseCreds();

// Route Supabase writes (pipeline_runs) to local; the dashboard upload still
// goes to prod via the captured creds above.
const localUrl = process.env.LOCAL_SUPABASE_URL;
const localKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (localUrl && localKey) {
  process.env.SUPABASE_URL = localUrl;
  process.env.SUPABASE_SERVICE_KEY = localKey;
}

import { execSync, execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import PQueue from "p-queue";
import type { Post } from "../api/fetchEligiblePosts";
import { SupabaseLogger } from "../api/supabaseClient";
import { getBotById } from "../bots/index";
import { processSingleTweet } from "../pipeline/orchestration/processTweet";
import { withBotConfig } from "../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../pipeline/cost-tracking/costTracker";
import { runABTests, withForcedPicks } from "../pipeline/ab-testing/abTests";
import { AB_TESTS } from "../pipeline/ab-testing/abTestsData";
import { createTweetLog, getLoggedBotId, withTweetLog } from "../pipeline/utils/tweetLog";
import { llm } from "../pipeline/llm/llm";
import { jsonSchemaResponseFormat } from "../pipeline/prompts/responseFormat";
import { stripJsonFences } from "../pipeline/utils/jsonOutput";
import { fetchTimedTranscript, type SubtitleCue } from "../pipeline/media/ytDlpDownload";
import { initOutputFolder, resultToCsvRow, errorToCsvRow } from "./outputWriter";
import { autoOpenInDashboard } from "./dashboardAutoOpen";
import { closeBrowser } from "../pipeline/utils/browserManager";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VideoMeta {
  url: string;
  id: string;
  title: string;
}

interface ExtractedClaim {
  /** Neutral, self-contained restatement of the claim. */
  claim: string;
  /** Opus's truth judgement from its own knowledge (7-point scale). */
  judgement: string;
  /** Verbatim transcript span the claim rests on. */
  quote: string;
  /** Start time in the video, in seconds (YouTube only — absent for text transcripts). */
  timestampSeconds?: number;
  /** Deep-link into the video at the claim's timestamp (YouTube only). */
  videoLink?: string;
}

interface ClaimsFile {
  video: VideoMeta;
  range: { beginMin: number; endMin: number | null };
  claims: ExtractedClaim[];
}

interface ClaimResult extends ExtractedClaim {
  needsCorrection: boolean;
  outcome: string;
  outcomeReason: string | null;
  noteStatus: string | null;
  correction: string;
  sources: string[];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  url?: string;
  begin: number;
  end: number | null;
  lang: string;
  claims?: string;
  transcriptFile?: string;
  extractOnly: boolean;
  transcriptOnly: boolean;
  concurrency: number;
  name?: string;
  dashboard: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const num = (name: string): number | undefined => {
    const v = flag(name);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (Number.isNaN(n)) {
      console.error(`${name} requires a number (got "${v}")`);
      process.exit(1);
    }
    return n;
  };

  const url = flag("--url");
  const claims = flag("--claims");
  const transcriptFile = flag("--transcript-file");
  if (!url && !claims && !transcriptFile) {
    console.error("Provide --url <youtube-url>, --transcript-file <path> (local transcript), or --claims <file.json> (re-check).");
    process.exit(1);
  }

  return {
    url,
    transcriptFile,
    begin: num("--begin") ?? 0,
    end: num("--end") ?? null,
    lang: flag("--lang") ?? "en",
    claims,
    extractOnly: args.includes("--extract-only"),
    transcriptOnly: args.includes("--transcript-only"),
    concurrency: num("--concurrency") ?? 5,
    name: flag("--name"),
    dashboard: !args.includes("--no-dashboard"),
  };
}

// ---------------------------------------------------------------------------
// Stage 1: claim extraction
// ---------------------------------------------------------------------------

const CLAIM_EXTRACTION_MODEL = "anthropic/claude-opus-4.6";

// Ordered most-true → most-false; the index drives which claims get fact-checked.
const JUDGEMENTS = [
  "certainly true",
  "likely true",
  "somewhat likely true",
  "uncertain",
  "somewhat likely false",
  "likely false",
  "certainly false",
] as const;

// Only fact-check claims Opus isn't confident are true: "uncertain" and below.
const FACT_CHECK_FROM = JUDGEMENTS.indexOf("uncertain");
function shouldFactCheck(judgement: string): boolean {
  const idx = (JUDGEMENTS as readonly string[]).indexOf(judgement);
  return idx === -1 || idx >= FACT_CHECK_FROM; // unknown / error judgement → check to be safe
}

function extractionSystemPrompt(withTimestamps: boolean): string {
  const fields = [
    `- "claim": the neutral, self-contained statement.`,
    `- "judgement": how true the claim is, using only your own knowledge — one of: ${JUDGEMENTS.join(", ")}.`,
    `- "quote": the verbatim transcript text the claim is based on.`,
    ...(withTimestamps ? [`- "timestampSeconds": the start time (the number in [brackets]) of the line where the quote begins.`] : []),
  ];
  return `You extract checkable factual claims from a transcript.

Extract EVERY distinct claim the speakers make or rely on, including implicit ones — things presented as background fact or presupposed, not only what is stated outright. Split compound statements into separate claims.

Write each claim in NEUTRAL, SELF-CONTAINED language:
- Strip the speaker's rhetoric, framing, hedging, and tone — state the underlying factual proposition plainly, as a neutral third party would.
- Resolve pronouns and references so the claim stands entirely on its own. Each claim is fact-checked in isolation with NONE of the surrounding transcript, so it must carry all the context it needs (who, what, when, where).

Skip pure opinion, value judgments, predictions, jokes, and anything not falsifiable.

For each claim return:
${fields.join("\n")}`;
}

function renderTranscript(cues: SubtitleCue[]): string {
  return cues.map((c) => `[${Math.floor(c.start)}] ${c.text}`).join("\n");
}

/** Seconds → "m:ss" (or "h:mm:ss" past an hour) for the human-readable transcript.txt. */
function formatTimestamp(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function renderTranscriptTxt(cues: SubtitleCue[]): string {
  return cues.map((c) => `[${formatTimestamp(c.start)}] ${c.text}`).join("\n") + "\n";
}

function writeTranscriptTxt(folderPath: string, transcriptTxt: string): string {
  const p = path.join(folderPath, "transcript.txt");
  fs.writeFileSync(p, transcriptTxt);
  return p;
}

function claimsResponseFormat(withTimestamps: boolean) {
  const properties: Record<string, unknown> = {
    claim: { type: "string", description: "Neutral, self-contained restatement of the claim." },
    judgement: { type: "string", enum: [...JUDGEMENTS], description: "How true the claim is, from your own knowledge." },
    quote: { type: "string", description: "Verbatim transcript text the claim is based on." },
  };
  const required = ["claim", "judgement", "quote"];
  if (withTimestamps) {
    properties.timestampSeconds = { type: "number", description: "Start time in seconds (the number in [brackets])." };
    required.push("timestampSeconds");
  }
  return jsonSchemaResponseFormat("video_claims", {
    type: "object",
    properties: { claims: { type: "array", items: { type: "object", properties, required, additionalProperties: false } } },
    required: ["claims"],
    additionalProperties: false,
  });
}

interface RawClaim {
  claim: string;
  judgement: string;
  quote: string;
  timestampSeconds?: number;
}

/** One Opus extraction call over a rendered transcript (segment or chunk). */
async function runExtraction(transcriptForLlm: string, withTimestamps: boolean): Promise<RawClaim[]> {
  const response: any = await llm.create({
    model: CLAIM_EXTRACTION_MODEL,
    messages: [
      { role: "system", content: extractionSystemPrompt(withTimestamps) },
      { role: "user", content: transcriptForLlm },
    ],
    response_format: claimsResponseFormat(withTimestamps),
    reasoning_effort: "high",
  } as any);
  const content = response.choices?.[0]?.message?.content ?? "{}";
  return (JSON.parse(stripJsonFences(content)) as { claims: RawClaim[] }).claims ?? [];
}

function buildVideoLink(id: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${id}&t=${Math.max(0, Math.floor(seconds))}s`;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Snap the model's timestamp to the cue whose (short) text is the longest
 * substring of the quote — gives a precise deep-link. Falls back to the
 * model-reported timestamp when nothing lines up.
 */
const MIN_SNAP_MATCH_CHARS = 12;
function snapTimestamp(quote: string, cues: SubtitleCue[], fallback: number): number {
  const q = normalize(quote);
  if (!q) return fallback;
  let best = fallback;
  let bestLen = 0;
  for (const cue of cues) {
    const t = normalize(cue.text);
    if (t.length > bestLen && q.includes(t)) {
      best = cue.start;
      bestLen = t.length;
    }
  }
  return bestLen >= MIN_SNAP_MATCH_CHARS ? best : fallback;
}

/** YouTube path: timestamped cues → claims with snapped timestamps + deep-links. */
async function extractClaims(cues: SubtitleCue[], video: VideoMeta): Promise<ExtractedClaim[]> {
  const raws = await runExtraction(
    `Transcript segment (lines are "[startSeconds] text"):\n\n${renderTranscript(cues)}`,
    true,
  );
  return raws.map((c) => {
    const timestampSeconds = snapTimestamp(c.quote, cues, c.timestampSeconds ?? 0);
    return { claim: c.claim, judgement: c.judgement, quote: c.quote, timestampSeconds, videoLink: buildVideoLink(video.id, timestampSeconds) };
  });
}

// Long transcripts are chunked so each Opus call stays exhaustive (one giant
// call tends to summarize/sample rather than extract every claim) and to dodge
// output-token limits. Split on blank lines so speaker turns stay intact.
const EXTRACTION_CHUNK_CHARS = 12_000;
function chunkTranscript(text: string): string[] {
  const blocks = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let cur = "";
  for (const block of blocks) {
    if (cur && cur.length + block.length > EXTRACTION_CHUNK_CHARS) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + block.trim();
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/** Text path: a plain transcript (no timestamps) → claims (quote is the citation). */
async function extractClaimsFromText(text: string, concurrency: number): Promise<ExtractedClaim[]> {
  const chunks = chunkTranscript(text);
  const queue = new PQueue({ concurrency });
  const perChunk = await Promise.all(
    chunks.map((chunk) => queue.add(() => runExtraction(`Transcript excerpt:\n\n${chunk}`, false))),
  );
  return perChunk
    .flat()
    .filter((c): c is RawClaim => !!c)
    .map((c) => ({ claim: c.claim, judgement: c.judgement, quote: c.quote }));
}

/** Fetch just id + title via --print (full -J metadata busts execSync's buffer on YouTube). */
function fetchVideoMeta(url: string): VideoMeta {
  const out = execFileSync(
    "yt-dlp",
    ["--skip-download", "--no-warnings", "--print", "%(id)s", "--print", "%(title)s", url],
    { encoding: "utf8", timeout: 120_000 },
  );
  const [id = "", ...titleParts] = out.trim().split("\n");
  return { url, id, title: titleParts.join(" ").trim() };
}

function fetchTranscriptSegment(video: VideoMeta, begin: number, end: number | null, lang: string): SubtitleCue[] {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "cn-yt-subs-"));
  try {
    const cues = fetchTimedTranscript(video.url, dir, lang);
    if (!cues || cues.length === 0) {
      throw new Error(`No ${lang} transcript available for ${video.url}`);
    }
    const beginSec = begin * 60;
    const endSec = end !== null ? end * 60 : Infinity;
    return cues.filter((c) => c.start >= beginSec && c.start < endSec);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Stage 2: run the pipeline on each claim
// ---------------------------------------------------------------------------

// simple-bot with the cheap note-needed prefilter forced on; the remaining A/B
// dimensions (search provider, writer, verifier) sample as in production.
const FORCED_PICKS = { bot: "simple-bot", note_prefilter: "deepseek" } as const;

/** Result for a claim the pipeline didn't run (skipped as confident-true, or errored). */
function nonRunResult(claim: ExtractedClaim, outcome: string, outcomeReason: string): ClaimResult {
  return { ...claim, needsCorrection: false, outcome, outcomeReason, noteStatus: null, correction: "", sources: [] };
}

function buildClaimPost(claim: ExtractedClaim, video: VideoMeta, index: number): Post {
  return {
    id: `${video.id}-${index}`,
    author_id: "unknown",
    created_at: new Date().toISOString(),
    text: claim.claim,
    media: [],
  };
}

async function checkClaim(
  claim: ExtractedClaim,
  video: VideoMeta,
  index: number,
  total: number,
  logger: SupabaseLogger | null,
): Promise<{ result: ClaimResult; csvRow: string }> {
  const post = buildClaimPost(claim, video, index);

  const { config, picks } = withForcedPicks(FORCED_PICKS, () => runABTests(AB_TESTS));
  const bot = getBotById(config.botId);
  if (!bot) throw new Error(`No bot registered for id "${config.botId}"`);

  const log = createTweetLog();
  log.set("tweet.index", index + 1);
  log.set("tweet.total", total);
  const tweetResult = await withTweetLog(log, () =>
    withBotConfig(config, () =>
      withCostTracker(() => {
        log.set("bot.id", config.botId);
        log.set("bot.picks", picks);
        log.set("bot.config", config);
        return processSingleTweet({ post, bot, logger });
      }),
    ),
  );

  const pr = tweetResult.pipelineResult;
  const result: ClaimResult = {
    ...claim,
    needsCorrection: tweetResult.outcome === "candidate",
    outcome: tweetResult.outcome,
    outcomeReason: tweetResult.outcomeReason ?? null,
    noteStatus: tweetResult.noteStatus ?? null,
    correction: pr?.noteResult.note ?? "",
    sources: pr?.searchContextResult.citations ?? [],
  };
  const csvRow = resultToCsvRow({ url: claim.videoLink ?? "" }, getLoggedBotId(bot.id, log), tweetResult, "", log);
  return { result, csvRow };
}

function printClaim(index: number, total: number, r: ClaimResult): void {
  const head = r.needsCorrection
    ? `⚠️  CORRECTION NEEDED`
    : `✅ no correction (${r.outcome}${r.outcomeReason ? `: ${r.outcomeReason}` : ""})`;
  const lines = [
    `\n--- ${index + 1}/${total} --- ${head}`,
    `  claim:  ${r.claim}  [opus: ${r.judgement}]`,
    `  quote:  "${r.quote}"`,
  ];
  if (r.videoLink) lines.push(`  at:     ${r.videoLink}`);
  if (r.correction) lines.push(`  note:   ${r.correction}`);
  if (r.sources.length) lines.push(`  sources: ${r.sources.join("  ")}`);
  console.log(lines.join("\n"));
}

function writeClaimsJson(folderPath: string, claimsFile: ClaimsFile): string {
  const p = path.join(folderPath, "claims.json");
  fs.writeFileSync(p, JSON.stringify(claimsFile, null, 2));
  return p;
}

/**
 * pipeline_runs logging is best-effort. `new SupabaseLogger()` never throws (it
 * builds the client lazily), so probe reachability once up front — otherwise a
 * down local Supabase spams a connection error on every claim. The dashboard
 * upload uses prod creds separately and works regardless.
 */
const SUPABASE_PROBE_TIMEOUT_MS = 2000;
async function createLoggerIfReachable(): Promise<SupabaseLogger | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    await fetch(`${url}/rest/v1/`, { method: "HEAD", headers: { apikey: key }, signal: AbortSignal.timeout(SUPABASE_PROBE_TIMEOUT_MS) });
    return new SupabaseLogger();
  } catch {
    return null;
  }
}

async function runPipelineOnClaims(claimsFile: ClaimsFile, args: Args, transcriptTxt?: string): Promise<void> {
  const { video, claims } = claimsFile;
  const logger = await createLoggerIfReachable();
  console.log(
    logger
      ? `[checkYoutubeClaims] Logging pipeline_runs to ${process.env.SUPABASE_URL}`
      : `[checkYoutubeClaims] Supabase unreachable — skipping pipeline_runs logging (dashboard still uploads)`,
  );

  const output = initOutputFolder("youtube-claims", video.id, "simple-bot", args.name);
  console.log(`[checkYoutubeClaims] Output folder: ${output.folderPath}`);
  writeClaimsJson(output.folderPath, claimsFile);
  if (transcriptTxt) writeTranscriptTxt(output.folderPath, transcriptTxt);

  const results: (ClaimResult | null)[] = new Array(claims.length).fill(null);
  const queue = new PQueue({ concurrency: args.concurrency });
  let skipped = 0;

  for (const [i, claim] of claims.entries()) {
    // Opus is confident this is true → no need to spend the pipeline on it.
    if (!shouldFactCheck(claim.judgement)) {
      results[i] = nonRunResult(claim, "skipped", `judged ${claim.judgement}`);
      skipped++;
      continue;
    }
    queue.add(async () => {
      try {
        const { result, csvRow } = await checkClaim(claim, video, i, claims.length, logger);
        results[i] = result;
        output.appendRow(csvRow);
        printClaim(i, claims.length, result);
      } catch (err: any) {
        console.error(`[checkYoutubeClaims] ERROR on claim ${i + 1}: ${err?.message}`);
        results[i] = nonRunResult(claim, "error", err?.message ?? "unknown");
        output.appendRow(errorToCsvRow(claim.videoLink ?? "", err?.message ?? "unknown"));
      }
    });
  }
  const checked = claims.length - skipped;
  console.log(`[checkYoutubeClaims] Fact-checking ${checked} claims (uncertain or below); skipping ${skipped} confident-true`);
  await queue.onIdle();

  const finalResults = results.filter((r): r is ClaimResult => r !== null);
  fs.writeFileSync(
    path.join(output.folderPath, "results.json"),
    JSON.stringify({ video, results: finalResults }, null, 2),
  );

  const corrections = finalResults.filter((r) => r.needsCorrection).length;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`CHECKED ${checked} claims — ${corrections} need a correction (${skipped} skipped as confident-true)`);
  console.log(`Output: ${output.folderPath}`);
  console.log("=".repeat(60));

  if (args.dashboard) {
    await autoOpenInDashboard(output.csvPath, args.name ?? `youtube-${video.id}`);
  }
  try { await closeBrowser(); } catch {}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadClaimsFile(filePath: string): ClaimsFile {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as ClaimsFile;
  if (!parsed.video || !Array.isArray(parsed.claims)) {
    console.error(`${filePath} is not a valid claims.json (need { video, claims })`);
    process.exit(1);
  }
  return parsed;
}

async function main() {
  const args = parseArgs();

  // Re-check mode: skip extraction, run the pipeline on a saved claims.json.
  if (args.claims) {
    const file = loadClaimsFile(args.claims);
    console.log(`[checkYoutubeClaims] Re-checking ${file.claims.length} claims from ${args.claims}`);
    await runPipelineOnClaims(file, args);
    return;
  }

  // Local transcript mode: extract + check a plain .txt (no timestamps / deep-links).
  if (args.transcriptFile) {
    const text = fs.readFileSync(args.transcriptFile, "utf8");
    const label = path.basename(args.transcriptFile, path.extname(args.transcriptFile));
    const video: VideoMeta = { url: "", id: label, title: label };
    const wordCount = text.trim().split(/\s+/).length;
    console.log(`[checkYoutubeClaims] ${label}: ${wordCount} words — extracting claims with ${CLAIM_EXTRACTION_MODEL}...`);
    const claims = await extractClaimsFromText(text, args.concurrency);
    console.log(`[checkYoutubeClaims] Extracted ${claims.length} claims`);
    const claimsFile: ClaimsFile = { video, range: { beginMin: 0, endMin: null }, claims };
    if (args.extractOnly) {
      const dir = initOutputFolder("youtube-claims", video.id, "extract", args.name);
      console.log(`[checkYoutubeClaims] Wrote ${writeClaimsJson(dir.folderPath, claimsFile)}`);
      return;
    }
    await runPipelineOnClaims(claimsFile, args, text);
    return;
  }

  try {
    execSync("yt-dlp --version", { stdio: "pipe" });
  } catch {
    console.error("yt-dlp is not installed. Install with: brew install yt-dlp");
    process.exit(1);
  }

  const video = fetchVideoMeta(args.url!);
  console.log(`[checkYoutubeClaims] ${video.title} (${video.id})`);

  const cues = fetchTranscriptSegment(video, args.begin, args.end, args.lang);
  const span = `${args.begin}–${args.end ?? "end"} min`;
  const transcriptTxt = renderTranscriptTxt(cues);

  // Transcript-only: dump the transcript and stop — no LLM, no pipeline.
  if (args.transcriptOnly) {
    const dir = initOutputFolder("youtube-claims", video.id, "transcript", args.name);
    const p = writeTranscriptTxt(dir.folderPath, transcriptTxt);
    console.log(`[checkYoutubeClaims] Wrote ${p} (${cues.length} lines, ${span})`);
    return;
  }

  console.log(`[checkYoutubeClaims] ${cues.length} transcript cues in ${span} — extracting claims with ${CLAIM_EXTRACTION_MODEL}...`);
  const claims = await extractClaims(cues, video);
  console.log(`[checkYoutubeClaims] Extracted ${claims.length} claims`);
  const claimsFile: ClaimsFile = { video, range: { beginMin: args.begin, endMin: args.end }, claims };

  if (args.extractOnly) {
    const dir = initOutputFolder("youtube-claims", video.id, "extract", args.name);
    const claimsPath = writeClaimsJson(dir.folderPath, claimsFile);
    writeTranscriptTxt(dir.folderPath, transcriptTxt);
    for (const [i, c] of claims.entries()) {
      const at = c.videoLink ? `\n  at:    ${c.videoLink}` : "";
      console.log(`\n--- ${i + 1}/${claims.length} --- [${c.judgement}]\n  claim: ${c.claim}\n  quote: "${c.quote}"${at}`);
    }
    console.log(`\n[checkYoutubeClaims] Wrote ${claimsPath}`);
    return;
  }

  await runPipelineOnClaims(claimsFile, args, transcriptTxt);
}

main().catch((err) => {
  console.error("[checkYoutubeClaims] Fatal error:", err);
  process.exit(1);
});
