/**
 * The X tag bot: people tag @CommonNotesBot under a post, and it researches the
 * post and submits a Community Note, or says why it can't yet. It runs as the
 * cn-x-tag-bot service on the services box (ops/README.md).
 *
 *   bun run src/x-tag-bot/main.ts
 *     The service. It reads tags from the X Activity API stream and exits when
 *     the stream ends; systemd starts it again, and the stream resends the
 *     last five minutes.
 *
 *   bun run src/x-tag-bot/main.ts --dry-run <post-url> "<your comment>"
 *     Answers one made-up tag on a real post and prints the reply instead of
 *     posting it. The research runs in this process, nothing is stored, and
 *     nothing is submitted. Needs an OpenRouter key and a working X read token.
 */

import "dotenv/config";
import type { Post } from "../api/fetchEligiblePosts";
import { fetchTweetById } from "../api/fetchTweetById";
import { getSupabaseClient, SupabaseLogger } from "../api/supabaseClient";
import { runTweetCheck } from "../pipeline/orchestration/runTweetCheck";
import type { TweetComputeOutput } from "../pipeline/orchestration/processTweet";
import { submitApprovedNote } from "../pipeline/orchestration/submitApprovedNote";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import { nestDotKeys } from "../pipeline/utils/tweetLog";
import { requestTweetCheck } from "../service/client";
import { TAG_BOT_PICKS, TagBot } from "./bot";
import { writeNoNoteReply } from "./noNoteReply";
import type { NoteDraft } from "./replies";
import { createMemoryStore, createSupabaseStore } from "./store";
import { isEligibleForNotes, postReply, readActivityStream } from "./x";

const RETRY_INTERVAL_MS = 2 * 60_000;

if (process.argv[2] === "--dry-run") await dryRun(process.argv[3], process.argv[4]);
else await serve();

async function serve(): Promise<never> {
  const logger = new SupabaseLogger();
  const bot = new TagBot({
    store: createSupabaseStore(getSupabaseClient()),
    botUserId: requiredEnv("X_TAG_BOT_USER_ID"),
    postReply,
    fetchPost: fetchTweetById,
    // A person is waiting for the answer, like a reader waiting for a page.
    checkTweet: async (post, noteRequest) => (await requestTweetCheck({ priority: "reader", post, picks: TAG_BOT_PICKS, noteRequest })).output,
    recordRun: (post, output) => recordRun(logger, post, output),
    writeNoNoteReply,
    isEligible: isEligibleForNotes,
    submit: (post, draft) => submitApprovedNote(logger, { post, ...draft, lane: "x_tag", botName: "x-tag" }),
    now: () => new Date(),
  });

  setInterval(() => bot.tick().catch((error) => console.error("[x-tag] Retrying waiting notes failed:", error)), RETRY_INTERVAL_MS);
  console.log("[x-tag] Listening for tags");
  await readActivityStream((tag) => {
    bot.receive(tag).catch((error) => console.error(`[x-tag] Tag ${tag.id} failed:`, error));
  }, new AbortController().signal);
  throw new Error("The activity stream ended.");
}

async function recordRun(logger: SupabaseLogger, post: Post, output: TweetComputeOutput): Promise<string> {
  await logger.bulkInsertNewTweets([post]);
  const runId = await logger.createPipelineRun({
    tweet_id: post.id, bot_name: "x-tag", ab_test_picks: output.bot.picks, bot_config: output.bot.config,
  });
  await logger.completePipelineRun(runId, {
    outcome: output.outcome,
    outcome_reason: output.outcomeReason,
    error_message: output.errorMessage,
    final_stage: output.finalStage,
    note_text: output.noteText,
    search_results: output.pipelineResult?.searchContextResult.searchResults,
    logs: nestDotKeys(output.flatLog),
    cost: output.costUsd,
  });
  return runId;
}

async function dryRun(postUrl: string | undefined, comment: string | undefined): Promise<void> {
  const targetId = postUrl?.match(/status\/(\d+)/)?.[1];
  if (!targetId || !comment) throw new Error('Usage: --dry-run <post-url> "<your comment>"');
  const print = (label: string, text: string) => console.log(`\n--- ${label} ---\n${text}\n`);
  const bot = new TagBot({
    store: createMemoryStore(),
    botUserId: "bot",
    postReply: async (text) => {
      print("@CommonNotesBot would reply", text);
      return "2";
    },
    fetchPost: fetchTweetById,
    checkTweet: (post, noteRequest) => runTweetCheck({ post, picks: TAG_BOT_PICKS, noteRequest }),
    recordRun: async () => undefined,
    writeNoNoteReply,
    isEligible: async () => {
      console.log("[dry run] eligibility not checked, treated as eligible");
      return true;
    },
    submit: async (_post: Post, draft: NoteDraft) => {
      print("would submit", joinNoteWithSources(draft.text, draft.sources));
      return { status: "submitted", noteId: "dry-run" };
    },
    now: () => new Date(),
  });

  console.log("Researching the post. This takes about a minute.");
  await bot.receive({ id: "1", text: comment, authorId: "you", authorHandle: "you", repliedToId: targetId });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
