/* The Claude note writer's command line (GOO-507). The permanent Claude
 * session and its subagents call it to read the queue, save drafts, judge the
 * pipeline's notes, finish or hand back items, answer reviewers and change the
 * settings. Every write is logged in everything_claude_events.
 *
 * Usage: bun run claude-notes <command> [arguments]
 *   settings [writer=pipeline|claude] [approval=on|off] [--by jim|nathan|claude]
 *   queue                         queued items Claude has not handed back
 *   take <item id>                writes the post's text for the agents, logs the take
 *   draft <draft.json>            saves one draft; a note is posted unless approval is on
 *   pipeline-notes <item id>      the pipeline's AI notes on a post, as JSON
 *   keep-pipeline-note <item id> <note id> <reason>
 *   delete-pipeline-note <item id> <note id> <reason>
 *   finish <item id> <summary.json>
 *   hand-back <item id> <reason>
 *   messages                      reviewer messages still waiting for an answer
 *   watch                         waits until a reviewer message is waiting, prints it and exits
 *   answer <answer.json>          { draftId, reply, note?, sources?, passage? }
 *   withdraw <draft id> <reason>
 *   usage                         Claude Code usage of Jim's plan
 *   examples                      regenerates docs/note-examples.md from prod */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import {
  addDraft,
  addMessage,
  type Actor,
  changeSettings,
  deletePipelineNote,
  finishItem,
  handBack,
  keepPipelineNote,
  logEvent,
  type NewDraft,
  pipelineNotes,
  readItem,
  readSettings,
  rewrite,
  unansweredMessages,
  waitingItems,
  withdraw,
  type Writer,
} from "./store";
import { readUsage } from "./usage";

/** Where `take` writes a post's text for the note-finding agents. */
const POSTS_DIR = path.join(homedir(), ".local/share/claude-note-finder/posts");

const [command, ...args] = process.argv.slice(2);
function arg(index: number): string {
  const value = args[index];
  if (!value) throw new Error(`${command} needs more arguments. See the usage at the top of src/claude-notes/cli.ts`);
  return value;
}
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

function postDirName(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 80).replace(/-$/, "");
}

async function take(itemId: string) {
  const item = await readItem(itemId);
  const dir = path.join(POSTS_DIR, postDirName(item.url));
  mkdirSync(dir, { recursive: true });
  const creator = item.project?.name ?? "unknown";
  writeFileSync(path.join(dir, "post.md"), `# ${item.title ?? item.url}\n\nBy ${creator}, published ${item.published_at}\n${item.url}\n\n${item.full_text ?? ""}`);
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ itemId: item.id, url: item.url, title: item.title, creator, publishedAt: item.published_at }, null, 2));
  await logEvent({ actor: "claude", type: "item_taken", itemId });
  console.log(item.full_text ? dir : `${dir}\nThis item has no stored text yet. Read the page with: bun run read-page ${item.url}`);
}

function parseSettingsArgs(list: string[]): { change: { writer?: Writer; approvalRequired?: boolean }; by: Actor } {
  const change: { writer?: Writer; approvalRequired?: boolean } = {};
  let by: Actor = "claude";
  for (let i = 0; i < list.length; i++) {
    const [key, value] = (list[i] ?? "").split("=");
    if (key === "writer" && (value === "pipeline" || value === "claude")) change.writer = value;
    else if (key === "approval" && (value === "on" || value === "off")) change.approvalRequired = value === "on";
    else if (key === "--by") by = list[++i] as Actor;
    else throw new Error(`Unknown setting: ${list[i]}`);
  }
  return { change, by };
}

async function answer(file: string) {
  const a: { draftId: string; reply: string; note?: string; sources?: NewDraft["sources"]; passage?: string; reason?: string } = readJson(file);
  if (a.note) await rewrite(a.draftId, { actor: "claude", note: a.note, sources: a.sources, passage: a.passage, reason: a.reason ?? a.reply });
  await addMessage(a.draftId, "claude", a.reply);
  console.log(a.note ? "Answered and rewrote the note" : "Answered");
}

/** How often `watch` looks for new reviewer messages. */
const WATCH_POLL_MS = 10_000;

/** Runs until a reviewer message waits for an answer, prints the waiting
 *  messages and exits. Claude runs it as a background task, whose end wakes
 *  Claude up. */
async function watch() {
  for (;;) {
    const waiting = await unansweredMessages();
    if (waiting.length > 0) return print(waiting.map((m) => ({ draftId: m.draft_id, from: m.actor, text: (m.data as { text: string }).text })));
    await Bun.sleep(WATCH_POLL_MS);
  }
}

async function main() {
  switch (command) {
    case "settings": {
      const { change, by } = parseSettingsArgs(args);
      if (Object.keys(change).length > 0) await changeSettings(by, change);
      return print(await readSettings());
    }
    case "queue":
      return print((await waitingItems()).map(({ full_text, ...item }) => ({ ...item, hasText: Boolean(full_text) })));
    case "take":
      return take(arg(0));
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
    case "hand-back":
      return handBack(arg(0), args.slice(1).join(" "));
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
    default:
      throw new Error(`Unknown command ${command}. See the usage at the top of src/claude-notes/cli.ts`);
  }
}

await main();
