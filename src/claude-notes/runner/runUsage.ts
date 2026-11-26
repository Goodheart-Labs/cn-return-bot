/* What one Claude run used, read from Claude Code's output in its run folder
 * (GOO-837). The runner stores it on the run's everything_claude_runs row, so
 * the runs can be compared without their transcripts, which Claude Code keeps
 * for 30 days only. */

import { existsSync, readFileSync } from "fs";
import * as path from "path";

/** The tool that starts a subagent. Older Claude Code versions call it Task. */
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

export type RunUsage = {
  /** What the run would have cost on the API, as Claude Code reports it. */
  apiCostUsd: number | null;
  model: string | null;
  turns: number | null;
  /** How often the Claude itself called each tool. Its subagents' calls are not counted. */
  toolCalls: Record<string, number>;
  subagentCalls: number;
  /** Claude Code's tokens and cost per model, subagents and page summaries included. */
  modelUsage: Record<string, unknown> | null;
};

type StreamEvent = {
  type?: string;
  subtype?: string;
  model?: string;
  parent_tool_use_id?: string | null;
  message?: { content?: { type?: string; name?: string }[] };
  total_cost_usd?: number;
  num_turns?: number;
  modelUsage?: Record<string, unknown>;
};

function parseLines(text: string): StreamEvent[] {
  return text.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line) as StreamEvent];
    } catch {
      // A run killed mid-write leaves a cut-off last line.
      return [];
    }
  });
}

export function usageFromEvents(events: StreamEvent[]): RunUsage {
  const toolCalls: Record<string, number> = {};
  for (const event of events) {
    if (event.type !== "assistant" || event.parent_tool_use_id) continue;
    for (const block of event.message?.content ?? []) {
      if (block.type === "tool_use" && block.name) toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1;
    }
  }
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const result = events.findLast((e) => e.type === "result");
  return {
    apiCostUsd: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null,
    model: init?.model ?? null,
    turns: typeof result?.num_turns === "number" ? result.num_turns : null,
    toolCalls,
    subagentCalls: Object.entries(toolCalls).reduce((sum, [name, count]) => sum + (SUBAGENT_TOOLS.has(name) ? count : 0), 0),
    modelUsage: result?.modelUsage ?? null,
  };
}

/** A writer streams stream.jsonl; an isolated Claude answers one output.json. */
export function runUsage(runDir: string): RunUsage {
  const output = ["stream.jsonl", "output.json"].map((file) => path.join(runDir, file)).find(existsSync);
  return usageFromEvents(output ? parseLines(readFileSync(output, "utf8")) : []);
}
