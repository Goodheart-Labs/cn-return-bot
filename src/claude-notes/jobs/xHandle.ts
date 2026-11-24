/* A creator's X account (GOO-639). For every creator with a posted Claude
 * note whose X account nobody has looked up, one Claude searches the web,
 * asks Grok at most once, and saves what it found with
 * `claude-notes x-handle`. A creator whose account is saved drops out of the
 * list by itself. */

import { xAccountPrompt } from "../prompts";
import { CLAUDE_RUN_TAGS } from "../usageShare";
import { creatorsToLookUp, type CreatorToLookUp, xHandleChecked } from "../xAccounts";
import { type JobKind, mayRetry } from "./kind";

/** Lookups at once. They are small, so one at a time keeps them from crowding
 *  out posts. */
const MAX_LOOKUPS_RUNNING = 1;
/** A lookup has no deadline of its own. A Claude still at one after this long
 *  is stuck. */
const LOOKUP_MAX_MS = 60 * 60_000;

export const xHandleJob: JobKind<CreatorToLookUp> = {
  name: "x-handle",
  sessionPrefix: "cn-xacct-",
  maxRunning: MAX_LOOKUPS_RUNNING,
  tags: () => [CLAUDE_RUN_TAGS.commonNotes, CLAUDE_RUN_TAGS.xAccount],
  key: (creator) => creator.slug,
  waiting: () => creatorsToLookUp(),

  async prepare(creator, runDir) {
    return { prompt: xAccountPrompt({ creator, runDir }), command: { model: "opus", effort: "high" } };
  },

  stopAt: (_creator, startedAt) => startedAt + LOOKUP_MAX_MS,
  // The ledger has no column for a project, and the run folder names the creator.
  ref: () => null,

  /** A lookup that ended without saving an answer gets one more try. After that
   *  the creator waits for a person, who can enter the handle on the review card. */
  async close(creator, run) {
    console.log(`The Claude looking up ${creator.name}'s X account ended after ${Math.round((Date.now() - run.startedAt) / 60_000)} minutes`);
    if (await xHandleChecked(creator.slug)) return "closed";
    if (mayRetry(run)) return "retry";
    console.error(`Gave up on the X account of ${creator.name}: no Claude saved an answer; see ${run.runDir}`);
    return "gave_up";
  },
};
