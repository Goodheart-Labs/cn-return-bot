/**
 * Builds one HTML page from a gpt-notes run folder, to click through the whole
 * run: every agent's turns, the summary of its reasoning, each tool call with
 * its input and its full output, and what each request cost.
 *
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_11_12_gpt_trajectory_viewer/build.ts <run folder> <out.html>
 */
import { readFileSync, writeFileSync } from "fs";
import * as path from "path";

const [runDir, outFile] = process.argv.slice(2);
if (!runDir || !outFile) throw new Error("Usage: build.ts <run folder> <out.html>");

const readJsonl = (name: string) =>
  readFileSync(path.join(runDir, name), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const readJson = (name: string) => JSON.parse(readFileSync(path.join(runDir, name), "utf8"));

type Item = Record<string, any>;
type Step = { agent: string; turn: number; newInput: Item[]; output: Item[] };

const steps: Step[] = readJsonl("trajectory.jsonl");
const requests: Item[] = readJsonl("requests.jsonl");

/** The text of an item's content, whatever shape the SDK gave it. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n\n");
  if (value && typeof value === "object") {
    const v = value as Item;
    if (typeof v.text === "string") return v.text;
    if (v.type === "input_image") return `[image ${v.image ?? ""}]`;
    if ("content" in v) return textOf(v.content);
    if ("output" in v) return textOf(v.output);
  }
  return "";
}

const callIdOf = (item: Item) => item.callId ?? item.call_id ?? item.id;

/** Every tool result in the run, by the id of the call it answers. */
const results = new Map<string, string>();
for (const step of steps)
  for (const item of step.newInput)
    if (String(item.type).includes("function_call_result") || item.type === "function_call_output") results.set(callIdOf(item), textOf(item.output));

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return (raw as Record<string, unknown>) ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

const turns = steps.map((step) => {
  const usage = requests.find((r) => r.agent === step.agent && r.turn === step.turn) ?? {};
  const userMessages = step.newInput.filter((item) => item.role === "user").map((item) => textOf(item.content));
  const reasoning = step.output.filter((item) => item.type === "reasoning").map((item) => textOf(item.content ?? item.summary)).filter(Boolean);
  const messages = step.output.filter((item) => item.type === "message").map((item) => textOf(item.content)).filter(Boolean);
  const calls = step.output
    .filter((item) => item.type === "function_call")
    .map((item) => ({ id: callIdOf(item), tool: item.name as string, input: parseArguments(item.arguments), output: results.get(callIdOf(item)) ?? null }));
  return {
    agent: step.agent,
    turn: step.turn,
    startedAt: usage.startedAt,
    durationMs: usage.durationMs,
    costUsd: usage.costUsd,
    inputTokens: usage.inputTokens,
    cachedTokens: usage.cachedTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    userMessages,
    reasoning,
    messages,
    calls,
  };
});

const data = {
  folder: path.basename(runDir),
  job: readJson("job.json"),
  summary: readJson("summary.json"),
  answer: readJson("x-answer.json"),
  turns,
};

const template = readFileSync(path.join(import.meta.dir, "template.html"), "utf8");
const json = JSON.stringify(data).replace(/</g, "\\u003c");
writeFileSync(outFile, template.replace("/*DATA*/null", json));
console.log(`${turns.length} turns, ${turns.reduce((n, t) => n + t.calls.length, 0)} tool calls. Wrote ${outFile}`);
