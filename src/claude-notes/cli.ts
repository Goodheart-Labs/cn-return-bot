/* The Claude note writer's command line (GOO-507). The runner on Nathan's
 * ai-box and the Claude agents it starts call it to read the queue, save
 * drafts, finish items, answer reviewers and change the settings. Every
 * Common Notes write is logged in everything_claude_events. The two x- commands answer an X tweet (GOO-527)
 * on its pipeline_runs row.
 *
 * Usage: bun run claude-notes <command> [arguments]
 *   settings [writer=pipeline|claude] [by=jim|nathan|claude]
 *   queue                         queued items Claude is working on or has not taken yet
 *   take <item id>                writes the post's text for the agents, logs the take
 *   draft <draft.json>            saves one draft; a note is posted at once
 *   finish <item id> <summary.json>
 *   skip <item id> <reason>       marks a post checked because nothing in it is worth checking
 *   posted-since <ISO time>       the notes Claude posted since then, newest first
 *   messages                      reviewer messages still waiting for an answer
 *   answer <answer.json>          { draftId, reply, note?, sources?, reason? }; a note is a proposal the reviewer posts
 *   withdraw <draft id> <reason>
 *   usage                         Claude Code usage of the plan this machine is logged into
 *   examples                      regenerates the examples file from prod
 *   x-note <note.json>            { runId, note, reasoning }: queues a note on an X tweet for the next X run
 *   x-no-note <run id> <reason>   records that an X tweet needs no note
 *   judge-examples                rebuilds src/claude-notes/judge-examples.json from the reviews
 *   run                           the runner on ai-box (src/claude-notes/runner.ts)
 *   dispatch                      on the devbox: waits for jobs, starts them, prints their prompts and exits (src/claude-notes/dispatch.ts)
 *   dispatch-end <job key>        on the devbox: closes a job after its subagent returned, or prints its retry prompt
 *   dispatch-services             on the devbox: usage readings, the note judge and the examples, all the time */

import { readFileSync, writeFileSync } from "fs";
import { dispatch, dispatchEnd, dispatchServices } from "./dispatch";
import { JUDGE_EXAMPLES_PATH } from "./judge";
import {
  addDraft,
  answerMessage,
  type Actor,
  changeWriter,
  claudeQueue,
  finishItem,
  judgeExamples,
  type NewDraft,
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
import { declineXTweet, saveXNote } from "./xTweets";


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
    case "finish":
      return finishItem(arg(0), readJson(arg(1)));
    case "skip":
      return skipItem(arg(0), args.slice(1).join(" "));
    case "posted-since":
      return print(await postedSince(arg(0)));
    case "run":
      return import("./runner");
    case "messages":
      return print(await unansweredMessages());
    case "dispatch":
      return dispatch();
    case "dispatch-end":
      return dispatchEnd(arg(0));
    case "dispatch-services":
      return dispatchServices();
    case "answer":
      return answer(arg(0));
    case "withdraw":
      return print(await withdraw(arg(0), args.slice(1).join(" ")));
    case "usage":
      return print(await readUsage());
    case "examples":
      return import("./buildExamples");
    case "x-note": {
      const note: { runId: string; note: string; reasoning: string } = readJson(arg(0));
      await saveXNote(note.runId, note);
      return console.log("Saved. The next X run rates the note and submits it if X has room.");
    }
    case "x-no-note":
      await declineXTweet(arg(0), args.slice(1).join(" "));
      return console.log("Recorded that the tweet needs no note.");
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
