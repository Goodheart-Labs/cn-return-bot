/* Where a Claude host gets its posts (GOO-791). A host with a notewriter key
 * in CN_NOTEWRITER_KEY uses API v2 (src/notewriters/client.ts), as the runner
 * on the ai-box does since GOO-787. A host without one uses API v1
 * (src/notewriters/v1.ts), as hq does until Nathan gives it a key. Both hosts run the same jobs.ts on top of this.
 *
 * On v1 the server paces the host: the host subscribes with how often it
 * wants a feed post, and next_post answers when it is due. On v2 the host
 * paces itself. It keeps its pace and the time of its last feed reservation
 * in a small state file, and reserves a feed post only once that interval has
 * passed. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import { ENV_DIR } from "../cnEnv";
import type { Json } from "../everything-core/database.types";
import { notewriterClient, type NotewriterClient } from "../notewriters/client";
import { CLAUDE_NOTEWRITER } from "../notewriters/ids";
import * as v1 from "../notewriters/v1";

/** How often the host wants a feed post, null for none, and whether it takes
 *  reader requests, which are never paced. */
export type ClaudePace = { feedEveryMinutes: number | null; readerRequests: boolean };

/** A post the host holds: its reservation (v1 calls it the assignment), the
 *  post's id, and when the reservation ends unless it is finished first. */
export type HeldReservation = { reservation: string; itemId: string; deadline: string };

export interface ClaudeQueue {
  setPace(pace: ClaudePace): Promise<void>;
  /** Reserves one more post when one is due and waiting. */
  next(): Promise<HeldReservation | null>;
  held(): Promise<HeldReservation[]>;
  finish(reservation: string, options: { summary?: Json; skipReason?: string }): Promise<void>;
  /** Returns what became of the post, for the log. */
  fail(reservation: string, reason: string): Promise<string>;
  /** A v2 host calls notewriter_api_me as its sign of life, also while it
   *  takes nothing. A v1 host's subscribe every 5 minutes is its sign. */
  signOfLife(): Promise<void>;
}

const describeFailure = (post: "back_in_queue" | "failed") =>
  post === "failed" ? "the post failed, because no notewriter that takes reader requests is left for it" : "the post stays listed for the other notewriters";

const v1Queue: ClaudeQueue = {
  setPace: async (pace) => {
    await v1.subscribe(CLAUDE_NOTEWRITER, pace.feedEveryMinutes, pace.readerRequests);
  },
  next: async () => {
    const answer = await v1.nextPost(CLAUDE_NOTEWRITER);
    return answer.kind === "post" ? { reservation: answer.assignment, itemId: answer.item.id, deadline: answer.deadline } : null;
  },
  held: async () => (await v1.status(CLAUDE_NOTEWRITER)).open.map((open) => ({ reservation: open.assignment, itemId: open.item.id, deadline: open.deadline })),
  finish: async (reservation, options) => {
    await v1.finish(reservation, options);
  },
  fail: async (reservation, reason) => describeFailure((await v1.fail(reservation, reason)).post),
  signOfLife: async () => {},
};

/** How many posts of the list a v2 host tries to reserve in one go. Another
 *  notewriter may reserve a listed post first. */
const RESERVE_TRIES = 5;

type V2State = { pace: ClaudePace; lastFeedAt: number | null };
const V2_STATE_FILE = path.join(homedir(), ".local/share/claude-note-finder/v2-queue.json");
const NO_POSTS: V2State = { pace: { feedEveryMinutes: null, readerRequests: false }, lastFeedAt: null };

function readV2State(): V2State {
  return existsSync(V2_STATE_FILE) ? JSON.parse(readFileSync(V2_STATE_FILE, "utf8")) : NO_POSTS;
}

function writeV2State(state: V2State) {
  mkdirSync(path.dirname(V2_STATE_FILE), { recursive: true });
  writeFileSync(V2_STATE_FILE, JSON.stringify(state));
}

/** Lists posts no other notewriter of the team counts on and reserves the
 *  first one it gets as the only one of the team. A feed listing starts with
 *  any requested post the team has not reserved, as the plan has it: such a
 *  post is answered first, whoever takes it. */
async function reserveFirst(client: NotewriterClient, requestedOnly: boolean): Promise<HeldReservation | null> {
  const { posts } = await client.posts({ limit: RESERVE_TRIES, maxOthers: 0, othersFrom: "team", requestedOnly });
  for (const post of posts) {
    const answer = await client.reserve(post.id, 1);
    if (answer.kind === "reserved") return { reservation: answer.reservation, itemId: answer.post.id, deadline: answer.deadline };
  }
  return null;
}

/** Whether a feed post is due: once `feedEveryMinutes` passed since the last
 *  feed reservation. Exported for the tests. */
export function feedPostDue(state: V2State, now: number): boolean {
  const { feedEveryMinutes } = state.pace;
  if (feedEveryMinutes === null) return false;
  return state.lastFeedAt === null || now - state.lastFeedAt >= feedEveryMinutes * 60_000;
}

export function v2Queue(client: NotewriterClient): ClaudeQueue {
  return {
    setPace: async (pace) => writeV2State({ ...readV2State(), pace }),
    next: async () => {
      const state = readV2State();
      if (state.pace.readerRequests) {
        const requested = await reserveFirst(client, true);
        if (requested) return requested;
      }
      if (!feedPostDue(state, Date.now())) return null;
      const post = await reserveFirst(client, false);
      if (post) writeV2State({ ...state, lastFeedAt: Date.now() });
      return post;
    },
    held: async () => (await client.me()).open.map((open) => ({ reservation: open.reservation, itemId: open.post, deadline: open.deadline })),
    finish: async (reservation, options) => {
      await client.finish(reservation, options);
    },
    fail: async (reservation, reason) => {
      await client.fail(reservation, reason);
      return describeFailure("back_in_queue");
    },
    signOfLife: async () => {
      await client.me();
    },
  };
}

function chooseQueue(): ClaudeQueue {
  loadDotenv({ path: path.join(ENV_DIR, ".env"), quiet: true });
  const notewriterKey = process.env.CN_NOTEWRITER_KEY;
  if (!notewriterKey) return v1Queue;
  const supabaseUrl = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !apiKey) throw new Error("A host with CN_NOTEWRITER_KEY needs SUPABASE_URL and SUPABASE_SERVICE_KEY");
  return v2Queue(notewriterClient({ supabaseUrl, apiKey, notewriterKey }));
}

let queue: ClaudeQueue | undefined;
export const claudeQueue = (): ClaudeQueue => (queue ??= chooseQueue());
