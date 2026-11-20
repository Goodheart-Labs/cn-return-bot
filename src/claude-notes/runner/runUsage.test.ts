import { describe, expect, test } from "bun:test";
import { usageFromEvents } from "./runUsage";

const toolUse = (name: string, parent: string | null = null) => ({ type: "assistant", parent_tool_use_id: parent, message: { content: [{ type: "tool_use", name }] } });

describe("a run's usage", () => {
  test("counts the Claude's own tool calls and its subagents, not the subagents' calls", () => {
    const usage = usageFromEvents([
      { type: "system", subtype: "init", model: "claude-opus-5-5" },
      toolUse("WebSearch"),
      toolUse("WebSearch"),
      toolUse("Agent"),
      toolUse("WebFetch", "agent-call-1"),
      { type: "result", total_cost_usd: 0.42, num_turns: 4, modelUsage: { "claude-opus-5-5": { outputTokens: 10 } } },
    ]);
    expect(usage).toEqual({
      apiCostUsd: 0.42,
      model: "claude-opus-5-5",
      turns: 4,
      toolCalls: { WebSearch: 2, Agent: 1 },
      subagentCalls: 1,
      modelUsage: { "claude-opus-5-5": { outputTokens: 10 } },
    });
  });
  test("a run that died before it reported has no cost", () => {
    expect(usageFromEvents([toolUse("Bash")])).toMatchObject({ apiCostUsd: null, turns: null, toolCalls: { Bash: 1 } });
  });
});
