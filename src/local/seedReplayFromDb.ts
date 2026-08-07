/**
 * Seed the replay caches from a historical `pipeline_runs` row.
 *
 * This lets tryoutNotes re-run a past run locally while reusing data from that
 * run's production logs. The caller says how deep to replay by naming a level,
 * and each level also reuses everything the shallower levels reuse.
 *
 * At level "tweet" we reuse the Post, so there is no X fetch. The input, the
 * search, the writer and the gates are all rebuilt.
 * At level "input" we also reuse the whole BotInput by seeding the input cache
 * named in BIG_EVAL_INPUT_CACHE. createBotInput then returns straight away and
 * nothing is fetched for comments, media or author history.
 * At level "note" we also reuse the note the writer produced by seeding the
 * cache named in WRITER_CACHE. The orchestrator then replays from the two
 * gates, which are the note-needed judge and the source verifier.
 *
 * This module only seeds caches, so a replay needs no pipeline code changes.
 * The cache reads that already exist do the skipping. createBotInput calls
 * readInputCache, and the orchestrator calls readWriterCache. The run itself is
 * read from the production Supabase, because that is where production runs are
 * logged. That is a different database from the local Supabase the pipeline
 * writes to.
 */

import { getProdSupabaseCreds } from "./prodSupabaseCreds";
import { writeWriterCache, type WriterStageResult } from "../pipeline/replay/writerCache";
import { writeInputCache } from "../pipeline/input/inputCache";
import type { Post } from "../api/fetchEligiblePosts";
import type { BotInput } from "../pipeline/input/createBotInput";

/** The replay depths, listed from the shallowest to the deepest. A level seeds
 *  its own cache and the cache of every shallower level. */
export const REPLAY_LEVELS = ["tweet", "input", "note"] as const;
export type ReplayLevel = (typeof REPLAY_LEVELS)[number];
function rank(level: ReplayLevel): number {
  return REPLAY_LEVELS.indexOf(level);
}

/** The text runWriter puts between the post context and the research findings
 *  when it joins them into one user message. See src/pipeline/simple-bot/writer.ts.
 *  We split the logged message on it to recover the bare post context, which the
 *  verifier needs as its `postContext`. */
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
  /** The post as the original run saw it. It comes from logs.tweet.post. */
  post: Post;
  /** The video_description_strategy the input cache was written under. It is
   *  set at level "input" and at every deeper level. */
  inputStrategy?: string;
  /** The note we rebuilt from the logs. It is set at level "note". */
  noteText?: string;
  sources?: string[];
  /** True when the post context we recovered carried the verifier's feedback.
   *  That means the original run rewrote its note after the source verifier
   *  rejected the first one. */
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

/** Return the post the run saw. processTweet logs it verbatim under `tweet.post`. */
function reconstructPost(logs: any): Post | null {
  const post = logs?.tweet?.post;
  return post && typeof post.id === "string" ? (post as Post) : null;
}

/** Rebuild the full BotInput from the per-step logs. The structured media
 *  analysis is logged under media.gemini, and everything else under inputs.
 *  Returns null when the run never logged the inputs block. That happens when a
 *  run exited early, before it built its input. */
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
  };
}

/** Rebuild the output of the writer stage from a run's logs. That output is the
 *  note itself together with the post context it was written against. Returns
 *  null when the logs hold no note_writer step. An opus bot writes a different
 *  log layout, and a run that exited early never reached the writer. */
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

  // The note the verifier ran on is the last writer response in the log. Every
  // retry re-asks the writer on the same thread, so the first user message is
  // the same in all of them. That is why attempt 0 is the one we read it from.
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
      // Snippets only serve as a fallback for when the verifier cannot fetch a
      // source itself. Runs that used native search never had any, and snippets
      // are not logged either way. So a replay fetches the sources live.
      snippets: [],
    },
    // When the source verifier rejects a note, the orchestrator asks the writer
    // for a new one and passes the verifier's feedback along in the user
    // message. Finding that heading tells us the note we recovered is the
    // rewritten one.
    fromRevisedNote: postContext.includes("## Verifier feedback"),
  };
}

/** Look up the latest run for `tweetId` and seed the caches up to `level`. The
 *  cache directories are read from the BIG_EVAL_INPUT_CACHE and WRITER_CACHE
 *  environment variables, which the caller sets. */
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
