/* The GPT note writer (GOO-682): one agent per Common Notes post or X tweet,
 * built with the OpenAI Agents SDK on GPT-6.1 Terra. It gets the same task as
 * the Claude note writer on ai-box and the same examples as its system prompt.
 *
 * The agent's tools are OpenAI's hosted web search, which can also open a page
 * and search inside it, our own tools that save its answers, and a fork tool.
 * A fork is a copy of the agent that starts with the agent's whole
 * conversation so far and does one task, like Claude Code's fork subagents.
 *
 * Prompt caching works at three levels. The examples end in a cache
 * breakpoint, so every post or tweet reads them from the cache (model.ts).
 * OpenAI's implicit mode puts a breakpoint after the latest message or tool
 * results, so every turn reads the turns before it. And a fork's conversation
 * starts with its parent's, so the fork reads that from the cache too. This
 * only holds while every agent sends the same tools, in the same order, with
 * the same settings, because those are part of the cached prefix.
 *
 * The harness only records what the agent produced. The caller decides what
 * happens with it: the dry-run command (cli.ts) writes it to a folder. */

import { readFileSync } from "fs";
import * as path from "path";
import { Agent, run, tool, webSearchTool, type AgentInputItem, type AgentOutputItem, type ModelSettings, type Tool } from "@openai/agents";
import type OpenAI from "openai";
import { z } from "zod";
import type { NewDraft } from "../claude-notes/store";
import { xNoteProblems } from "../claude-notes/xTweets";
import { IMAGE_LINKS_HEADING } from "../pipeline/input/claudeTweetInput";
import { openAIClient, Transcript, TrackedModel, type RequestLog } from "./model";
import type { ServiceTier } from "./pricing";
import { forkBrief, OTHER_CALL_IN_FORK, postMessage, tweetMessage, type Job } from "./prompts";

const REPO = path.resolve(import.meta.dir, "../..");
const POST_EXAMPLES_PATH = path.join(REPO, "docs/note-examples.md");
const TWEET_EXAMPLES_PATH = path.join(REPO, "docs/x-note-examples.md");

/** The most model requests one agent may make. The SDK's own default is 10,
 *  far too few for a long post. */
const MAX_TURNS = 200;

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface HarnessSettings {
  effort: ReasoningEffort;
  /** Flex for normal use. Experiments use the standard tier, which OpenAI
   *  calls "default", so they run faster and never wait for capacity. */
  tier: ServiceTier;
}

export type XAnswer = { type: "note"; note: string; reasoning: string } | { type: "no_note"; reason: string };

/** Everything one run produced. */
export interface RunRecord {
  drafts: NewDraft[];
  /** Why the post is not worth checking, when the agent skipped it. */
  skipReason: string | null;
  xAnswer: XAnswer | null;
  requests: RequestLog[];
  forks: number;
  /** Forks that failed, for example by running out of turns. Their parent
   *  carries on without them, and the run's summary lists them. */
  forkErrors: string[];
}

/** What every agent of one run shares. The SDK hands it to every tool as the
 *  run's context. */
interface HarnessState {
  job: Job;
  settings: HarnessSettings;
  client: OpenAI;
  record: RunRecord;
}

/** A skipped post and an answered tweet end the run. A checked post ends when
 *  the agent stops. */
const isAnswered = (record: RunRecord) => record.skipReason !== null || record.xAnswer !== null;

// ---------------------------------------------------------------------------
// Tools that save the agent's answers
// ---------------------------------------------------------------------------

const draftSource = z.object({
  url: z.string(),
  quote: z.string().describe("At most 2 sentences copied exactly from the page"),
  explanation: z.string().describe("What it supports"),
});

const draftParameters = z.object({
  passage: z.string().describe("Copied verbatim from the post, the shortest span that carries the claim"),
  claim: z.string().describe("The passage's claim in neutral self-contained words"),
  kind: z.enum(["small_mistake", "missing_context", "wrong_or_misleading"]),
  outcome: z.enum(["note", "no_note_needed", "too_hard"]),
  note: z.string().describe("The note text, without links, or empty"),
  reasoning: z.string().describe("2 to 4 sentences: what you found and why the note says what it says"),
  sources: z.array(draftSource),
});

/** A passage the post does not contain word for word could not be shown on
 *  the page, so the tool refuses it and the model copies it again. */
function saveDraftTool(state: HarnessState, job: Extract<Job, { kind: "post" }>): Tool {
  const postText = postMessage(job);
  return tool({
    name: "save_draft",
    description: "Saves your finding on one passage of the post. A draft with outcome note is posted at once.",
    parameters: draftParameters,
    execute: async (draft) => {
      if (!postText.includes(draft.passage)) return "Not saved. The passage is not in the post word for word. Copy it exactly from the post.";
      state.record.drafts.push({ itemId: job.item.id, ...draft });
      return "Saved.";
    },
  });
}

function skipPostTool(state: HarnessState, isFork: boolean): Tool {
  return tool({
    name: "skip_post",
    description: "Ends your work on a post that has nothing worth checking.",
    parameters: z.object({ reason: z.string() }),
    execute: async ({ reason }) => {
      if (isFork) return "Only the agent that started you can skip the post. Put what you found in your answer.";
      state.record.skipReason = reason;
      return "Skipped.";
    },
  });
}

/** Like the Claude note writer's x-note command, it saves only the first
 *  answer for a tweet. */
function submitXNoteTool(state: HarnessState): Tool {
  return tool({
    name: "submit_x_note",
    description: "Submits a Community Note on the tweet.",
    parameters: z.object({
      note: z.string().describe("The note, with the links to its sources"),
      reasoning: z.string().describe("A few sentences on why the post needs it"),
    }),
    execute: async ({ note, reasoning }) => {
      if (state.record.xAnswer) return "The tweet already has an answer. Nothing was saved.";
      const problems = xNoteProblems(note.trim());
      if (problems.length) return `The note was not saved. ${problems.join(" ")}`;
      state.record.xAnswer = { type: "note", note: note.trim(), reasoning };
      return "Saved. The note goes into the note queue.";
    },
  });
}

function xNoNoteTool(state: HarnessState): Tool {
  return tool({
    name: "x_no_note",
    description: "Records that the tweet needs no note.",
    parameters: z.object({ reason: z.string() }),
    execute: async ({ reason }) => {
      if (state.record.xAnswer) return "The tweet already has an answer. Nothing was saved.";
      state.record.xAnswer = { type: "no_note", reason };
      return "Recorded that the tweet needs no note.";
    },
  });
}

// ---------------------------------------------------------------------------
// Forks
// ---------------------------------------------------------------------------

/** A fork's conversation: the agent's last request and the model's answer to
 *  it, exactly as the agent will send them in its own next request, so the
 *  fork reads all of it from the cache. The API needs a result for every
 *  function call of that answer. The fork's own call gets its task as the
 *  result, and the other calls get a note that its parent handles them. */
export function forkInput(lastInput: AgentInputItem[], lastOutput: AgentOutputItem[], forkCallId: string, task: string): AgentInputItem[] {
  const results: AgentInputItem[] = lastOutput
    .filter((item) => item.type === "function_call")
    .map((call) => ({
      type: "function_call_result",
      name: call.name,
      callId: call.callId,
      status: "completed",
      output: call.callId === forkCallId ? forkBrief(task) : OTHER_CALL_IN_FORK,
    }));
  return [...lastInput, ...lastOutput, ...results];
}

/** Forks start no forks, like Claude Code's. The tool stays in a fork's tool
 *  list all the same, because removing it would change the cached prefix. */
function forkTool(state: HarnessState, transcript: Transcript, isFork: boolean): Tool {
  return tool({
    name: "fork",
    description: "Starts a fork: a copy of you with your whole context so far, which does one task and answers with what it found. Several forks started in one turn run at the same time.",
    parameters: z.object({ task: z.string().describe("What the fork should do") }),
    execute: async ({ task }, _context, details) => {
      if (isFork) return "A fork cannot start forks. Do the work yourself.";
      const callId = details?.toolCall?.callId;
      if (!callId) throw new Error("The fork tool was called without a call id");
      state.record.forks += 1;
      const name = `fork ${state.record.forks}`;
      try {
        const result = await runAgent(state, name, forkInput(transcript.lastInput, transcript.lastOutput, callId, task), { isFork: true });
        return String(result.finalOutput ?? "");
      } catch (err) {
        const message = `${name} failed: ${(err as Error).message}`;
        state.record.forkErrors.push(message);
        return `The fork failed: ${(err as Error).message}`;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/** The same tools, in the same order, for the root agent and every fork. */
function harnessTools(state: HarnessState, transcript: Transcript, isFork: boolean): Tool[] {
  const { job } = state;
  const fork = forkTool(state, transcript, isFork);
  return job.kind === "post"
    ? [webSearchTool(), saveDraftTool(state, job), skipPostTool(state, isFork), fork]
    : [webSearchTool(), submitXNoteTool(state), xNoNoteTool(state), fork];
}

/** Every setting here is part of the cached prefix, so every agent of a run
 *  sends the same. GPT-6.1 finds its cache without a cache key. The key only
 *  splits OpenAI's cache accounting, here by post and tweet. */
function modelSettings(state: HarnessState): ModelSettings {
  return {
    reasoning: { effort: state.settings.effort },
    parallelToolCalls: true,
    promptCacheOptions: { mode: "implicit" },
    providerData: { service_tier: state.settings.tier, prompt_cache_key: `cn-notes-${state.job.kind}` },
  };
}

function runAgent(state: HarnessState, name: string, input: AgentInputItem[], options: { isFork: boolean }) {
  const transcript = new Transcript(name, state.record.requests);
  const agent = new Agent<HarnessState>({
    name,
    model: new TrackedModel(state.client, transcript),
    modelSettings: modelSettings(state),
    tools: harnessTools(state, transcript, options.isFork),
    // The root agent stops as soon as the post is skipped or the tweet has
    // its answer. A fork answers its parent in text.
    toolUseBehavior: options.isFork
      ? "run_llm_again"
      : () => (isAnswered(state.record) ? { isFinalOutput: true, isInterrupted: undefined, finalOutput: "Answered" } : { isFinalOutput: false, isInterrupted: undefined }),
  });
  return run(agent, input, { context: state, maxTurns: MAX_TURNS });
}

/** The image links the X run puts at the end of a tweet's input. GPT gets the
 *  images themselves, since it has no shell to download them with. */
export function tweetImageLinks(input: string): string[] {
  const [, list] = input.split(`\n\n${IMAGE_LINKS_HEADING}\n\n`);
  return list ? list.split("\n").filter((line) => line.startsWith("http")) : [];
}

/** The examples as the system prompt, then the task. */
function firstInput(job: Job): AgentInputItem[] {
  const examples = readFileSync(job.kind === "post" ? POST_EXAMPLES_PATH : TWEET_EXAMPLES_PATH, "utf8");
  const task: AgentInputItem =
    job.kind === "post"
      ? { role: "user", content: postMessage(job) }
      : {
          role: "user",
          content: [{ type: "input_text", text: tweetMessage(job) }, ...tweetImageLinks(job.input).map((image) => ({ type: "input_image" as const, image }))],
        };
  return [{ role: "system", content: examples }, task];
}

export async function runJob(job: Job, settings: HarnessSettings): Promise<RunRecord> {
  const record: RunRecord = { drafts: [], skipReason: null, xAnswer: null, requests: [], forks: 0, forkErrors: [] };
  await runAgent({ job, settings, client: openAIClient(), record }, "root", firstInput(job), { isFork: false });
  return record;
}
