/* The GPT note writer (GOO-682): one agent per Common Notes post or X tweet,
 * built with the OpenAI Agents SDK on GPT-6.1 Terra. It gets the same task as
 * the Claude note writer on ai-box and the same examples as its system prompt.
 *
 * The agent's tools are our web tools (webTools.ts: a Serper search, and
 * opening a page and finding text in it through the pipeline's fetch ladder),
 * our own tools that save its answers, and a subagent tool. A subagent is the
 * SDK's own: an agent that starts from a fresh conversation with the examples
 * and the task its parent wrote, does research with the web tools, and answers
 * in text.
 *
 * Prompt caching works at two levels. The examples end in a cache breakpoint,
 * so every post or tweet reads them from the cache (model.ts). And OpenAI's
 * implicit mode, its default, puts a breakpoint after the latest message or
 * tool results, so every turn reads the turns before it. The harness does not
 * name the mode, because OpenRouter refuses the setting. The tools are part of
 * the cached prefix too. The main agent and the subagents have different
 * tools, so each keeps its own cached copy of the examples.
 *
 * The harness only records what the agent produced. The caller decides what
 * happens with it: the dry-run command (cli.ts) writes it to a folder. */

import { readFileSync } from "fs";
import * as path from "path";
import { Agent, run, tool, type AgentInputItem, type ModelSettings, type Tool } from "@openai/agents";
import type OpenAI from "openai";
import { z } from "zod";
import type { NewDraft } from "../claude-notes/store";
import { xNoteProblems } from "../claude-notes/xTweets";
import { IMAGE_LINKS_HEADING } from "../pipeline/input/claudeTweetInput";
import { openAIClient, TrackedModel, type Provider, type RunLog } from "./model";
import type { ServiceTier } from "./pricing";
import { postMessage, subagentBrief, tweetMessage, type Job } from "./prompts";
import { webTools, type WebToolUse } from "./webTools";

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
  provider: Provider;
  /** The examples file for the system prompt, when an experiment replaces the
   *  usual one. */
  examplesPath?: string;
}

export type XAnswer = { type: "note"; note: string; reasoning: string } | { type: "no_note"; reason: string };

/** Everything one run produced. */
export interface RunRecord extends RunLog {
  drafts: NewDraft[];
  /** Why the post is not worth checking, when the agent skipped it. */
  skipReason: string | null;
  xAnswer: XAnswer | null;
  web: WebToolUse;
}

/** What every agent of one run shares. The SDK hands it to every tool as the
 *  run's context. */
interface HarnessState {
  job: Job;
  settings: HarnessSettings;
  client: OpenAI;
  record: RunRecord;
  /** The examples, as the first message of every conversation. */
  examples: AgentInputItem;
  /** One set for the whole run, so every agent shares the fetched pages. */
  webTools: Tool[];
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
function saveDraftTool(state: HarnessState, job: Extract<Job, { kind: "post" }>): Tool<HarnessState> {
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

function skipPostTool(state: HarnessState): Tool<HarnessState> {
  return tool({
    name: "skip_post",
    description: "Ends your work on a post that has nothing worth checking.",
    parameters: z.object({ reason: z.string() }),
    execute: async ({ reason }) => {
      state.record.skipReason = reason;
      return "Skipped.";
    },
  });
}

/** Like the Claude note writer's x-note command, it saves only the first
 *  answer for a tweet. */
function submitXNoteTool(state: HarnessState): Tool<HarnessState> {
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

function xNoNoteTool(state: HarnessState): Tool<HarnessState> {
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
// Agents
// ---------------------------------------------------------------------------

/** Every setting here is part of the cached prefix, so the main agent and the
 *  subagents send the same. GPT-6.1 finds its cache without a cache key. The key only
 *  splits OpenAI's cache accounting, here by post and tweet. */
function modelSettings(state: HarnessState): ModelSettings {
  const shared = { service_tier: state.settings.tier, prompt_cache_key: `cn-notes-${state.job.kind}` };
  return {
    // The summary of its reasoning shows in the trajectory why the model made
    // each tool call.
    reasoning: { effort: state.settings.effort, summary: "auto" },
    parallelToolCalls: true,
    ...(state.settings.provider === "openai" ? { providerData: shared } : openRouterSettings(shared)),
  };
}

/** OpenRouter keeps no conversations, so it refuses stored responses. The
 *  model's reasoning then travels back in encrypted form with each request.
 *  Only OpenAI's own endpoints are allowed, because Azure's copy of the model
 *  costs 20% more and keeps a cache of its own. */
function openRouterSettings(shared: Record<string, string>): ModelSettings {
  return {
    store: false,
    providerData: { ...shared, include: ["reasoning.encrypted_content"], provider: { only: ["openai"] } },
  };
}

/** The SDK's subagent: an agent run as a tool. Its conversation starts with
 *  the examples and the task its parent wrote. Several subagents started in
 *  one turn run at the same time. */
function subagentTool(state: HarnessState): Tool<HarnessState> {
  const subagent = new Agent<HarnessState>({
    name: "subagent",
    model: new TrackedModel(state.client, state.settings.provider, "subagent", state.record),
    modelSettings: modelSettings(state),
    tools: state.webTools,
  });
  return subagent.asTool({
    toolName: "subagent",
    toolDescription: "Starts a subagent that does one research task with search, open_page and find_in_page, and answers with what it found. It sees only the examples and the task you give it.",
    parameters: z.object({ task: z.string().describe("What to check, and everything you found that might help, with the facts, quotes and links") }),
    inputBuilder: ({ params }) => [state.examples, { role: "user", content: subagentBrief(params.task) }],
    runOptions: { maxTurns: MAX_TURNS },
  });
}

/** The main agent stops as soon as the post is skipped or the tweet has its
 *  answer. */
function mainAgent(state: HarnessState): Agent<HarnessState> {
  const { job } = state;
  const tools =
    job.kind === "post"
      ? [...state.webTools, saveDraftTool(state, job), skipPostTool(state), subagentTool(state)]
      : [...state.webTools, submitXNoteTool(state), xNoNoteTool(state), subagentTool(state)];
  return new Agent<HarnessState>({
    name: "main",
    model: new TrackedModel(state.client, state.settings.provider, "main", state.record),
    modelSettings: modelSettings(state),
    tools,
    toolUseBehavior: () =>
      isAnswered(state.record) ? { isFinalOutput: true, isInterrupted: undefined, finalOutput: "Answered" } : { isFinalOutput: false, isInterrupted: undefined },
  });
}

/** The image links the X run puts at the end of a tweet's input. GPT gets the
 *  images themselves, since it has no shell to download them with. */
export function tweetImageLinks(input: string): string[] {
  const [, list] = input.split(`\n\n${IMAGE_LINKS_HEADING}\n\n`);
  return list ? list.split("\n").filter((line) => line.startsWith("http")) : [];
}

function taskMessage(job: Job): AgentInputItem {
  if (job.kind === "post") return { role: "user", content: postMessage(job) };
  const images = tweetImageLinks(job.input).map((image) => ({ type: "input_image" as const, image }));
  return { role: "user", content: [{ type: "input_text", text: tweetMessage(job) }, ...images] };
}

export async function runJob(job: Job, settings: HarnessSettings): Promise<RunRecord> {
  const record: RunRecord = { drafts: [], skipReason: null, xAnswer: null, web: { searches: 0, pagesFetched: 0, calls: [] }, requests: [], trajectory: [], failedRequests: [] };
  const examplesPath = settings.examplesPath ?? (job.kind === "post" ? POST_EXAMPLES_PATH : TWEET_EXAMPLES_PATH);
  const examples: AgentInputItem = { role: "system", content: readFileSync(examplesPath, "utf8") };
  const state = { job, settings, client: openAIClient(settings.provider), record, examples, webTools: webTools(record.web) };
  await run(mainAgent(state), [examples, taskMessage(job)], { context: state, maxTurns: MAX_TURNS });
  return record;
}
