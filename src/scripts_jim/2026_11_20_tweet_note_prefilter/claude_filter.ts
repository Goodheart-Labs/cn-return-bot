/**
 * The Claude Code note writer's own prompt as a filter (GOO-835): Haiku at
 * medium effort reads each sampled tweet exactly as the claude-code bot would,
 * with the 100 examples in its system prompt and Claude Code's regular tools,
 * and decides whether the tweet needs a note. A tweet passes the filter when
 * Haiku writes a note.
 *
 * The prompt is the production tweetPrompt with one change: Claude answers by
 * writing answer.json in its run folder instead of running `claude-notes x-note`
 * or `x-no-note`, so nothing reaches the note queue. With --lean-to-note, one
 * sentence asks it to write a note unless it is sure that none is needed.
 *
 * Each Claude runs on this machine's own Claude Code login, in its run folder,
 * with no environment secrets, no user or project settings (so no CLAUDE.md,
 * hooks or MCP servers of ours), and the image guard hook. The tweet's images
 * reach it only as Gemini's descriptions.
 *
 * Input: claude_inputs.jsonl from fetch_claude_inputs.py. Output: one line per
 * tweet in runs/claude_<arm>.jsonl. A tweet already in that file is skipped,
 * so a stopped run can be started again.
 *
 *   bun run src/scripts_jim/2026_11_20_tweet_note_prefilter/claude_filter.ts [--lean-to-note] [--limit N] [--concurrency N]
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import { parseArgs } from "util";
import PQueue from "p-queue";
import type { Post } from "../../api/fetchEligiblePosts";
import { guardedSettingsFile } from "../../claude-notes/imageGuard";
import { tweetPrompt, X_EXAMPLES_PATH } from "../../claude-notes/prompts";
import type { XTweet } from "../../claude-notes/xTweets";
import type { AuthorNoteHistory } from "../../pipeline/input/authorHistory";
import type { GeminiMediaResult } from "../../pipeline/media/mediaAnalysisGemini";
import { buildUserMessage } from "../../pipeline/prompts/input/userMessage";

const DATA_DIR = "/home/jim/dev/data/goo-835";
const CLAUDE_BIN = path.join(homedir(), ".local/bin/claude");
const MODEL = "haiku";
const EFFORT = "medium";
/** The production arms with the plainest prompt: the examples, without Jim's
 *  taste sentences and without the research nudge. */
const PICKS = { claude_x_taste: "examples_only", claude_x_research_nudge: "off", claude_x_examples: "with" };
const TIME_LIMIT_MS = 20 * 60_000;
/** A settings file that does not exist, so the run folder's settings hold only the image guard. */
const NO_BOX_SETTINGS = "/nonexistent/settings.json";
const KEPT_ENV_NAMES = ["HOME", "PATH", "USER", "LANG"];

const LEAN_TO_NOTE = "If you are not sure whether the tweet needs a note, write one. Answer that it needs no note only when you are sure that it needs none.";

type InputRow = {
  tweet_id: string;
  helpful: boolean;
  run_id: string;
  created_at: string;
  post: Post;
  media: GeminiMediaResult | null;
  note_history: AuthorNoteHistory | null;
};

type Answer = { note?: string; reasoning?: string; no_note?: string };

const { values: args } = parseArgs({
  options: {
    "lean-to-note": { type: "boolean", default: false },
    limit: { type: "string" },
    concurrency: { type: "string", default: "6" },
  },
});
const ARM = `${MODEL}_${EFFORT}${args["lean-to-note"] ? "_lean" : ""}`;
const RESULTS_PATH = path.join(DATA_DIR, "runs", `claude_${ARM}.jsonl`);

function tweetInput(row: InputRow): string {
  return buildUserMessage({
    post: row.post,
    tweetMedia: row.media?.tweetMedia ?? [],
    quotedTweetMedia: row.media?.quotedTweetMedia ?? [],
    authorNoteHistory: row.note_history ?? undefined,
    now: new Date(row.created_at),
  });
}

function replaceOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`The production prompt no longer contains: ${from.slice(0, 80)}`);
  return text.replace(from, to);
}

/** The production prompt, answering into answer.json instead of the note queue. */
function filterPrompt(row: InputRow, runDir: string): string {
  const tweet = { runId: row.run_id, tweetId: row.tweet_id, input: tweetInput(row), picks: PICKS } as XTweet;
  let prompt = tweetPrompt({ tweet, runDir });
  const answerStart = prompt.indexOf("If the post needs a note, write");
  const answerEnd = prompt.indexOf("Stop once one of the two has succeeded.") + "Stop once one of the two has succeeded.".length;
  if (answerStart < 0 || answerEnd < answerStart) throw new Error("The production prompt's answer paragraph changed");
  const answer = `If the post needs a note, write ${runDir}/answer.json as { "note": "<the note, with the links to its sources>", "reasoning": "<a few sentences on why the post needs it>" }. A note has at most 280 characters, where each link counts as one, and needs at least one link. If the post needs no note, write ${runDir}/answer.json as { "no_note": "<why>" }. Stop once the file is written.`;
  prompt = prompt.slice(0, answerStart) + answer + prompt.slice(answerEnd);
  prompt = replaceOnce(prompt, "run x-no-note with the reason that the image could not be checked", "answer that it needs no note, with the reason that the image could not be checked");
  if (args["lean-to-note"]) prompt = replaceOnce(prompt, "You always need to provide at least one source", `${LEAN_TO_NOTE} You always need to provide at least one source`);
  return prompt;
}

type StreamEvent = { type: string; total_cost_usd?: number; num_turns?: number; duration_ms?: number; is_error?: boolean; message?: { content?: { type: string; name?: string }[] } };

function readStream(file: string) {
  const events: StreamEvent[] = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  const toolCounts: Record<string, number> = {};
  for (const event of events) {
    if (event.type !== "assistant") continue;
    for (const block of event.message?.content ?? []) if (block.type === "tool_use" && block.name) toolCounts[block.name] = (toolCounts[block.name] ?? 0) + 1;
  }
  return { result: events.findLast((event) => event.type === "result"), toolCounts };
}

function readAnswer(runDir: string): Answer | null {
  const file = path.join(runDir, "answer.json");
  if (!existsSync(file)) return null;
  // Haiku sometimes writes a stray tag such as </content> after the object.
  const text = readFileSync(file, "utf8");
  try {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

async function runClaude(row: InputRow) {
  const runDir = path.join(DATA_DIR, "claude_runs", ARM, row.tweet_id);
  mkdirSync(runDir, { recursive: true });
  const prompt = filterPrompt(row, runDir);
  writeFileSync(path.join(runDir, "prompt.md"), prompt);
  guardedSettingsFile(runDir, NO_BOX_SETTINGS);
  const flags = [
    "--model", MODEL, "--effort", EFFORT,
    "--append-system-prompt-file", X_EXAMPLES_PATH,
    "--exclude-dynamic-system-prompt-sections",
    "--setting-sources", "project", "--strict-mcp-config",
    "--permission-mode", "bypassPermissions", "--settings", path.join(runDir, "settings.json"),
    "--output-format", "stream-json", "--verbose", "--no-session-persistence",
  ];
  const env = Object.fromEntries(KEPT_ENV_NAMES.map((name) => [name, process.env[name] ?? ""]));
  const started = Date.now();
  const child = Bun.spawn([CLAUDE_BIN, "-p", prompt, ...flags], {
    cwd: runDir,
    env,
    stdout: Bun.file(path.join(runDir, "stream.jsonl")),
    stderr: Bun.file(path.join(runDir, "stderr.txt")),
  });
  const timer = setTimeout(() => child.kill(), TIME_LIMIT_MS);
  const exitCode = await child.exited;
  clearTimeout(timer);
  const { result, toolCounts } = readStream(path.join(runDir, "stream.jsonl"));
  const answer = readAnswer(runDir);
  const decision = answer?.note ? "note" : answer?.no_note ? "no_note" : "none";
  const line = {
    tweet_id: row.tweet_id,
    helpful: row.helpful,
    decision,
    note: answer?.note ?? null,
    reason: answer?.no_note ?? answer?.reasoning ?? null,
    exit_code: exitCode,
    timed_out: Date.now() - started >= TIME_LIMIT_MS,
    cost_usd: result?.total_cost_usd ?? null,
    turns: result?.num_turns ?? null,
    seconds: (Date.now() - started) / 1000,
    tools: toolCounts,
  };
  appendFileSync(RESULTS_PATH, JSON.stringify(line) + "\n");
  console.log(`${row.tweet_id} helpful=${row.helpful} ${decision} $${line.cost_usd?.toFixed(3)} ${Math.round(line.seconds)}s ${JSON.stringify(toolCounts)}`);
}

const done = new Set(existsSync(RESULTS_PATH) ? readFileSync(RESULTS_PATH, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line).tweet_id) : []);
const rows: InputRow[] = readFileSync(path.join(DATA_DIR, "claude_inputs.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const todo = rows.filter((row) => !done.has(row.tweet_id)).slice(0, args.limit ? Number(args.limit) : undefined);
console.log(`${ARM}: ${todo.length} tweets to run, ${done.size} already done`);
// The examples are about 120,000 tokens of system prompt. Claudes started
// together each write them into the prompt cache, so the first runs alone and
// the others read its cache entry.
const [first, ...rest] = todo;
if (first) await runClaude(first);
const queue = new PQueue({ concurrency: Number(args.concurrency) });
for (const row of rest) queue.add(() => runClaude(row));
await queue.onIdle();
