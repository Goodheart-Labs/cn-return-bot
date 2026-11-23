/**
 * Reads every page of the GOO-766 read log that reached hosted Jina again,
 * this time through self-hosted Jina, and saves both outcomes side by side
 * (GOO-855).
 *
 * The input is the read log's records that have a "Jina Reader" step, copied
 * from the services box:
 *   ssh root@95.217.155.79 'grep -h "\"step\":\"Jina Reader\"" /var/lib/cn-page-reads/*.jsonl' > ~/dev/data/goo-853/jina-reads.jsonl
 * Self-hosted Jina must answer on 127.0.0.1:8789. For the real comparison that
 * is the services box's container, reached through an SSH tunnel, so every
 * page is fetched from the box's address as in production:
 *   ssh -N -L 8789:127.0.0.1:8789 root@95.217.155.79
 *
 * Usage: bun run src/scripts_jim/2026_11_23_self_hosted_jina/compare.ts [--limit N] [--out <file>]
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { classifyMarkdown } from "../../pipeline/fetch/fetchLadder";
import { fetchWithJinaReader } from "../../pipeline/fetch/jinaReader";

const DATA_DIR = `${homedir()}/dev/data/goo-853`;
const PARALLEL_READS = 4;

interface LoggedStep {
  step: string;
  result: string;
  status?: number;
  chars?: number;
  ms: number;
}

interface LoggedRead {
  id: string;
  input: string;
  outcome: string;
  steps: LoggedStep[];
  text?: string;
}

const { values } = parseArgs({ options: { limit: { type: "string" }, out: { type: "string" } } });
const outFile = values.out ?? `${DATA_DIR}/self-hosted.jsonl`;
const done = new Set(existsSync(outFile) ? readFileSync(outFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line).id as string) : []);

const reads: LoggedRead[] = readFileSync(`${DATA_DIR}/jina-reads.jsonl`, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const todo = reads.filter((read) => !done.has(read.id)).slice(0, values.limit ? Number(values.limit) : undefined);
console.log(`${reads.length} logged reads, ${done.size} already compared, ${todo.length} to go`);

let next = 0;
await Promise.all(Array.from({ length: PARALLEL_READS }, async () => {
  while (next < todo.length) {
    const read = todo[next++]!;
    appendFileSync(outFile, `${JSON.stringify(await compare(read))}\n`);
  }
}));

async function compare(read: LoggedRead) {
  const hostedStep = read.steps.find((step) => step.step === "Jina Reader")!;
  const started = Date.now();
  const selfHosted = await fetchWithJinaReader(read.input);
  const ms = Date.now() - started;
  const markdown = selfHosted.type === "page" ? selfHosted.markdown : "";
  const verdict = selfHosted.type === "page" ? classifyMarkdown(markdown) : selfHosted.type;
  console.log(`${hostedStep.result.slice(0, 20).padEnd(20)} -> ${String(verdict).padEnd(12)} ${ms}ms ${read.input}`);
  return {
    id: read.id,
    url: read.input,
    hosted: { result: hostedStep.result, status: hostedStep.status, chars: read.outcome === "page" ? (read.text?.length ?? 0) : 0 },
    selfHosted: { result: verdict, status: "status" in selfHosted ? selfHosted.status : undefined, reason: selfHosted.type === "failed" ? selfHosted.reason : undefined, chars: markdown.length, ms },
    wordOverlap: read.outcome === "page" && read.text ? wordOverlap(read.text, markdown) : null,
    text: markdown,
  };
}

/** The share of the hosted text's distinct words that the self-hosted text
 *  also has. 1 means self-hosted found every word hosted Jina found. */
function wordOverlap(hostedText: string, selfHostedText: string): number {
  const hostedWords = new Set(words(hostedText));
  if (hostedWords.size === 0) return 1;
  const selfHostedWords = new Set(words(selfHostedText));
  let shared = 0;
  for (const word of hostedWords) if (selfHostedWords.has(word)) shared++;
  return shared / hostedWords.size;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/\p{L}{3,}/gu) ?? [];
}
