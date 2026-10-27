/* The Claude note writer's command line (GOO-507). The runner on Nathan's
 * ai-box and the Claude agents it starts call it to read the queue, save
 * drafts, judge the pipeline's notes, finish or hand back items, answer
 * reviewers and change the settings. Every write is logged in
 * everything_claude_events.
 *
 * Usage: bun run claude-notes <command> [arguments]
 *   settings [writer=pipeline|claude] [by=jim|nathan|claude]
 *   queue                         queued items Claude is working on or has not taken yet
 *   take <item id>                writes the post's text for the agents, logs the take
 *   draft <draft.json>            saves one draft; a note is posted at once
 *   pipeline-notes <item id>      the pipeline's AI notes on a post, as JSON
 *   keep-pipeline-note <item id> <note id> <reason>
 *   delete-pipeline-note <item id> <note id> <reason>
 *   finish <item id> <summary.json>
 *   hand-back <item id> <reason>
 *   skip <item id> <reason>       marks a post checked because nothing in it is worth checking
 *   posted-since <ISO time>       the notes Claude posted since then, newest first
 *   messages                      reviewer messages still waiting for an answer
 *   watch                         waits for reviewer messages, queued items or a due digest, prints it and exits
 *   answer <answer.json>          { draftId, reply, note?, sources?, reason? }; a note is a proposal the reviewer posts
 *   withdraw <draft id> <reason>
 *   usage                         Claude Code usage of the plan this machine is logged into
 *   examples                      regenerates the examples file from prod
 *   judge-examples                rebuilds src/claude-notes/judge-examples.json from the reviews
 *   run                           the runner on ai-box (src/claude-notes/runner.ts) */

import { readFileSync, writeFileSync } from "fs";
import { JUDGE_EXAMPLES_PATH } from "./judge";
import {
  addDraft,
  answerMessage,
  type Actor,
  changeWriter,
  claudeQueue,
  deletePipelineNote,
  finishItem,
  handBack,
  judgeExamples,
  keepPipelineNote,
  type NewDraft,
  pipelineNotes,
  postedSince,
  propose,
  readSettings,
  skipItem,
  unansweredMessages,
  withdraw,
  type Writer,
} from "./store";
import { take } from "./take";
import { readUsage } from "./usage";


const [command, ...args] = process.argv.slice(2);
// Many commands write to prod, so a flag such as --help must not run one.
// No command takes flags, so any argument that looks like one stops the CLI.
const flag = args.find((a) => a.startsWith("--"));
if (flag) throw new Error(`${command} takes no flags, got ${flag}. See the usage at the top of src/claude-notes/cli.ts`);
function arg(index: number): string {
  const value = args[index];
  if (!value) throw new Error(`${command} needs more arguments. See the usage at the top of src/claude-notes/cli.ts`);
  return value;
}
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));


function parseSettingsArgs(list: string[]): { writer: Writer | undefined; by: Actor } {
  let writer: Writer | undefined;
  let by: Actor = "claude";
  for (const entry of list) {
    const [key, value] = entry.split("=");
    if (key === "writer" && (value === "pipeline" || value === "claude")) writer = value;
    else if (key === "by" && (value === "jim" || value === "nathan" || value === "claude")) by = value;
    else throw new Error(`Unknown setting: ${entry}`);
  }
  return { writer, by };
}

async function answer(file: string) {
  const a: { draftId: string; reply: string; note?: string; sources?: NewDraft["sources"]; reason?: string } = readJson(file);
  if (a.note) await propose(a.draftId, { note: a.note, sources: a.sources, reason: a.reason ?? a.reply });
  await answerMessage(a.draftId, a.reply);
  console.log(a.note ? "Answered and proposed a new text" : "Answered");
}

/** How often `watch` looks for work. */
const WATCH_POLL_MS = 30_000;
/** `watch` also ends after this long without work, so Claude posts its digest
 *  to Slack every few hours. */
const DIGEST_EVERY_MS = 3 * 60 * 60 * 1000;

/** Runs until there is something to do, prints what and exits: reviewer
 *  messages waiting for an answer, queued items while Claude writes the notes,
 *  or a digest that is due. Claude runs it as a background task, whose end
 *  wakes Claude up. */
async function watch() {
  const startedAt = Date.now();
  for (;;) {
    const messages = await unansweredMessages();
    if (messages.length > 0) return print({ wake: "messages", messages: messages.map((m) => ({ draftId: m.draft_id, from: m.actor, text: (m.data as { text: string }).text })) });
    const { writer } = await readSettings();
    const items = writer === "claude" ? (await claudeQueue()).waiting : [];
    if (items.length > 0) return print({ wake: "queue", items });
    if (Date.now() - startedAt > DIGEST_EVERY_MS) return print({ wake: "digest" });
    await Bun.sleep(WATCH_POLL_MS);
  }
}

async function main() {
  switch (command) {
    case "settings": {
      const { writer, by } = parseSettingsArgs(args);
      if (writer) await changeWriter(by, writer);
      return print(await readSettings());
    }
    case "queue":
      return print(await claudeQueue());
    case "take": {
      const taken = await take(arg(0));
      return console.log(taken.kind === "taken" ? taken.dir : `SKIPPED: ${taken.reason}. The item is marked checked.`);
    }
    case "draft":
      return print(await addDraft(readJson(arg(0))));
    case "pipeline-notes":
      return print(await pipelineNotes(arg(0)));
    case "keep-pipeline-note":
      return keepPipelineNote(arg(0), arg(1), args.slice(2).join(" "));
    case "delete-pipeline-note":
      return deletePipelineNote(arg(0), arg(1), args.slice(2).join(" "));
    case "finish":
      return finishItem(arg(0), readJson(arg(1)));
    case "skip":
      return skipItem(arg(0), args.slice(1).join(" "));
    case "hand-back":
      return handBack(arg(0), args.slice(1).join(" "));
    case "posted-since":
      return print(await postedSince(arg(0)));
    case "run":
      return import("./runner");
    case "messages":
      return print(await unansweredMessages());
    case "watch":
      return watch();
    case "answer":
      return answer(arg(0));
    case "withdraw":
      return print(await withdraw(arg(0), args.slice(1).join(" ")));
    case "usage":
      return print(await readUsage());
    case "examples":
      return import("./buildExamples");
    case "judge-examples": {
      const examples = await judgeExamples();
      writeFileSync(JUDGE_EXAMPLES_PATH, JSON.stringify(examples, null, 1) + "\n");
      const helpful = examples.filter((e) => e.outcome === "helpful").length;
      return console.log(`Wrote ${examples.length} examples (${helpful} helpful, ${examples.length - helpful} not helpful) to ${JUDGE_EXAMPLES_PATH}`);
    }
    default:
      throw new Error(`Unknown command ${command}. See the usage at the top of src/claude-notes/cli.ts`);
  }
}

await main();
