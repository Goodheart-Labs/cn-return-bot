/**
 * The bot's side of the X API. Replies are posted as @CommonNotesBot with its
 * OAuth 1.0a keys (X_TAG_BOT_*). Tags and replies arrive through the X Activity
 * API stream, read with the app's bearer token. The eligibility check uses the
 * notewriter's keys, because only the notewriter can write notes.
 */

import axios from "axios";
import { getOAuth1Headers } from "../api/getOAuthToken";
import { evaluateNote } from "../pipeline/score/noteEvaluationFilter";

const POSTS_URL = "https://api.x.com/2/tweets";
const STREAM_URL = "https://api.x.com/2/activity/stream";
/** The most X resends after a reconnect. It covers a restart by autodeploy. */
const BACKFILL_MINUTES = 5;
const REQUEST_TIMEOUT_MS = 30_000;

/** A post that tagged the bot or replied to one of its posts. */
export interface IncomingPost {
  /** "mention" when the post writes the bot's handle, "reply" when it replies
   *  directly to one of the bot's posts. */
  event: "mention" | "reply";
  id: string;
  text: string;
  authorId: string;
  authorHandle: string;
  repliedToId?: string;
  quotedId?: string;
}

export async function postReply(text: string, inReplyToId: string): Promise<string> {
  const body = { text, reply: { in_reply_to_tweet_id: inReplyToId } };
  const response = await axios.post(POSTS_URL, body, {
    headers: { ...getOAuth1Headers(POSTS_URL, "POST", JSON.stringify(body), "tagbot"), "Content-Type": "application/json" },
    timeout: REQUEST_TIMEOUT_MS,
  });
  const id = response.data?.data?.id;
  if (typeof id !== "string") throw new Error(`X returned no id for the reply: ${JSON.stringify(response.data).slice(0, 300)}`);
  return id;
}

/** Whether X takes our notes on the post. evaluate_note answers the question
 *  without publishing anything, and it refuses an ineligible post with the
 *  same reason a submission gets. */
export async function isEligibleForNotes(postId: string, noteText: string): Promise<boolean> {
  try {
    await evaluateNote(postId, noteText);
    return true;
  } catch (error: any) {
    if (JSON.stringify(error?.response?.data ?? "").includes("ineligible")) return false;
    throw error;
  }
}

/** Reads the Activity API stream until it ends or the signal aborts. X sends
 *  one JSON event per line and blank lines to keep the connection alive. */
export async function readActivityStream(onPost: (post: IncomingPost) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${STREAM_URL}?backfill_minutes=${BACKFILL_MINUTES}`, {
    headers: { Authorization: `Bearer ${requiredEnv("X_TAG_BOT_BEARER_TOKEN")}` },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`The activity stream answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    buffered += decoder.decode(chunk.value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const post = incomingPostOf(JSON.parse(line));
      if (post) onPost(post);
    }
  }
}

/** The post inside a post.mention.create or post.reply.create event. Other
 *  events are ignored. */
export function incomingPostOf(event: any): IncomingPost | null {
  const data = event?.data;
  if (data?.event_type !== "post.mention.create" && data?.event_type !== "post.reply.create") return null;
  const payload = data.payload;
  const author = (data.includes?.users ?? []).find((user: any) => user.id === payload.author_id);
  const referenced = (type: string) => payload.referenced_tweets?.find((ref: any) => ref.type === type)?.id;
  return {
    event: data.event_type === "post.mention.create" ? "mention" : "reply",
    id: payload.id,
    text: payload.text,
    authorId: payload.author_id,
    authorHandle: author?.username ?? payload.author_id,
    repliedToId: referenced("replied_to"),
    quotedId: referenced("quoted"),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
