/**
 * Seed the cheap-bot replay caches from a historical pipeline_runs row.
 *
 * Lets tryoutNotes re-run a past run locally while reusing data from its prod
 * logs, choosing how deep to replay via nested levels (each includes the
 * previous):
 *   - "tweet": reuse the Post (skip the X fetch); rebuild input/search/writer/gates.
 *   - "input": also reuse the full BotInput (seed BIG_EVAL_INPUT_CACHE) so
 *              createBotInput short-circuits — no comment/media/author fetch.
 *   - "note":  also reuse the written note (seed WRITER_CACHE) so the
 *              orchestrator replays from the two gates (judge + verifier).
 *
 * Pure cache-seeding — no pipeline code changes. The existing cache-read paths
 * (createBotInput → readInputCache, orchestrator → readWriterCache) do the
 * short-circuiting. Reads from PROD Supabase (where production runs are logged),
 * independent of the local Supabase the pipeline writes to.
 */

import { getProdSupabaseCreds } from "./prodSupabaseCreds";
import { writeWriterCache, type WriterStageResult } from "../pipeline/replay/writerCache";
import { writeInputCache } from "../pipeline/input/inputCache";
import type { Post } from "../api/fetchEligiblePosts";
import type { BotInput } from "../pipeline/input/createBotInput";

/** Replay depth, ordered shallow → deep. Each level seeds its own cache plus
 *  every shallower level's. */
export const REPLAY_LEVELS = ["tweet", "input", "note"] as const;
export type ReplayLevel = (typeof REPLAY_LEVELS)[number];
function rank(level: ReplayLevel): number {
  return REPLAY_LEVELS.indexOf(level);
}

/** How runWriter joins the post context and the research brief into one user
 *  message (src/pipeline/simple-bot/writer.ts). We split on it to recover the
 *  bare post context the verifier needs as `postContext`. */
const WRITER_FINDINGS_SEPARATOR = "\n\n## Research findings\n\n";

const DEFAULT_VIDEO_STRATEGY = "frames";

interface PipelineRunRow {
  id: string;
  tweet_id: string;
  note_id: string | null;
  bot_name: string | null;
  outcome: string | null;
  created_at: string;
  logs: unknown;
}

export interface SeedResult {
  tweetId: string;
  runId: string;
  botName: string | null;
  outcome: string | null;
  level: ReplayLevel;
  /** The post as the original run saw it (from logs.tweet.post). */
  post: Post;
  /** video_description_strategy the input cache was written under (level ≥ input). */
  inputStrategy?: string;
  /** Reconstructed writer note (level = note). */
  noteText?: string;
  sources?: string[];
  /** True when the reconstructed post context carried verifier-revision
   *  feedback (the run rewrote its note after a failed verification). */
  fromRevisedNote?: boolean;
}

async function fetchLatestRun(tweetId: string): Promise<PipelineRunRow | null> {
  const { url, serviceKey } = getProdSupabaseCreds();
  if (!url || !serviceKey) {
    throw new Error("Prod Supabase creds unavailable — cannot seed replay from DB");
  }
  const params = new URLSearchParams({
    tweet_id: `eq.${tweetId}`,
    select: "id,tweet_id,note_id,bot_name,outcome,created_at,logs",
    order: "created_at.desc",
    limit: "1",
  });
  const resp = await fetch(`${url}/rest/v1/pipeline_runs?${params}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!resp.ok) {
    throw new Error(`pipeline_runs query failed (${resp.status}): ${await resp.text()}`);
  }
  const rows = (await resp.json()) as PipelineRunRow[];
  return rows[0] ?? null;
}

/** The post the run saw, logged verbatim by processTweet (`tweet.post`). */
function reconstructPost(logs: any): Post | null {
  const post = logs?.tweet?.post;
  return post && typeof post.id === "string" ? (post as Post) : null;
}

/** Rebuild the full BotInput from the per-step logs. Structured media analysis
 *  lives under media.gemini.*, the rest under inputs.*. Returns null if the run
 *  never logged the inputs block (e.g. an early-exit before input was built). */
function reconstructBotInput(logs: any): BotInput | null {
  const inputs = logs?.inputs;
  if (!inputs) return null;
  const gemini = logs?.media?.gemini;
  return {
    mediaResult: {
      tweetMedia: Array.isArray(gemini?.tweetMedia) ? gemini.tweetMedia : [],
      quotedTweetMedia: Array.isArray(gemini?.quotedTweetMedia) ? gemini.quotedTweetMedia : [],
    },
    authorHistory: inputs?.author?.noteHistory ?? undefined,
    comments: inputs?.comments?.text ?? undefined,
    mediaMadeWithAiLabel: !!inputs?.mediaMadeWithAiLabel,
    warnings: [],
  };
}

/** Reconstruct the writer-stage output (note + post context) from a run's logs.
 *  Returns null when the logs lack a note_writer step (e.g. an opus bot whose
 *  log layout differs, or a run that early-exited before the writer). */
function buildWriterStage(
  logs: any,
): { stage: Extract<WriterStageResult, { kind: "writer_done" }>; fromRevisedNote: boolean } | null {
  const attempts = logs?.note_writer_steps?.note_writer?.attempts;
  if (!attempts || typeof attempts !== "object") return null;

  const indices = Object.keys(attempts)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (indices.length === 0) return null;

  // The note the verifier ran on is the final logged writer response. The user
  // message is identical across char-limit retries, so attempt 0 carries it.
  const firstAttempt = attempts[String(indices[0])];
  let response: { note_text?: string; sources?: string[] } | undefined;
  for (const i of indices) {
    if (attempts[String(i)]?.response) response = attempts[String(i)].response;
  }
  const userMsg =
    firstAttempt?.messages?.find?.((m: any) => m.role === "user") ?? firstAttempt?.messages?.[1];
  const userContent: unknown = userMsg?.content;

  if (!response?.note_text || typeof userContent !== "string") return null;

  const sepIdx = userContent.indexOf(WRITER_FINDINGS_SEPARATOR);
  const postContext = sepIdx >= 0 ? userContent.slice(0, sepIdx) : userContent;
  const findings = sepIdx >= 0 ? userContent.slice(sepIdx + WRITER_FINDINGS_SEPARATOR.length) : "";

  const queries = logs?.note_writer_steps?.query_writer?.queries;

  return {
    stage: {
      kind: "writer_done",
      userMessage: postContext,
      findings,
      queries: Array.isArray(queries) ? queries : [],
      noteText: response.note_text,
      sources: Array.isArray(response.sources) ? response.sources : [],
      // Snippets are only a verifier fetch-fallback; native-search runs never
      // had them and they aren't logged, so replay fetches sources live.
      snippets: [],
    },
    // A revision rewrites the writer's user message to include verifier
    // feedback; if we see that marker the reconstructed note is post-revision.
    fromRevisedNote: postContext.includes("## Verifier feedback"),
  };
}

/** Look up the latest run for `tweetId` and seed the caches up to `level`.
 *  Cache dirs are read from BIG_EVAL_INPUT_CACHE / WRITER_CACHE (set
 *  by the caller). */
export async function seedReplayFromDb(tweetId: string, level: ReplayLevel): Promise<SeedResult> {
  const run = await fetchLatestRun(tweetId);
  if (!run) throw new Error(`No pipeline_runs row found for tweet ${tweetId}`);
  const logs = run.logs as any;

  const post = reconstructPost(logs);
  if (!post) {
    throw new Error(`Run ${run.id} for tweet ${tweetId} did not log tweet.post — cannot replay`);
  }

  const result: SeedResult = {
    tweetId,
    runId: run.id,
    botName: run.bot_name,
    outcome: run.outcome,
    level,
    post,
  };

  if (rank(level) >= rank("input")) {
    const botInput = reconstructBotInput(logs);
    if (!botInput) {
      throw new Error(`Run ${run.id} for tweet ${tweetId} has no reconstructable input (missing logs.inputs)`);
    }
    const strategy = logs?.bot?.config?.video_description_strategy ?? DEFAULT_VIDEO_STRATEGY;
    writeInputCache(post, strategy, botInput);
    result.inputStrategy = strategy;
  }

  if (rank(level) >= rank("note")) {
    const built = buildWriterStage(logs);
    if (!built) {
      throw new Error(
        `Run ${run.id} (bot ${run.bot_name ?? "?"}) for tweet ${tweetId} has no replayable writer note in its logs`,
      );
    }
    writeWriterCache(tweetId, built.stage);
    result.noteText = built.stage.noteText;
    result.sources = built.stage.sources;
    result.fromRevisedNote = built.fromRevisedNote;
  }

  return result;
}
