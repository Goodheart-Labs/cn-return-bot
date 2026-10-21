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
 *   skip <item id> <reason>       records that a post was judged not worth checking
 *   messages                      reviewer messages still waiting for an answer
 *   watch                         waits for reviewer messages, queued items or a due digest, prints it and exits
 *   answer <answer.json>          { draftId, reply, note?, sources?, passage? }
 *   withdraw <draft id> <reason>
 *   usage                         Claude Code usage of Jim's plan
 *   examples                      regenerates docs/note-examples.md from prod */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
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
  isVideo,
  nathanNotedItem,
  pipelineNotes,
  postDir,
  readItem,
  readSettings,
  rewrite,
  unansweredMessages,
  waitingItems,
  withdraw,
  type Writer,
} from "./store";
import { fetchAndStoreItemText } from "../everything/worker";
import { readUsage } from "./usage";


const [command, ...args] = process.argv.slice(2);
function arg(index: number): string {
  const value = args[index];
  if (!value) throw new Error(`${command} needs more arguments. See the usage at the top of src/claude-notes/cli.ts`);
  return value;
}
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));


/** Writes the post's text where the agents read it. A post without stored
 *  text, such as a new video or a requested page, is read first the way the
 *  pipeline reads it. If that fails, the item should be handed back. */
/** Nathan's own fact-checks are not redone. */
const NATHAN_SKIP_REASON = "Nathan already fact-checked this post by hand";

async function take(itemId: string) {
  if (await nathanNotedItem(itemId)) {
    await logEvent({ actor: "claude", type: "item_skipped", itemId, data: { reason: NATHAN_SKIP_REASON } });
    await finishItem(itemId, { skipped: true, reason: NATHAN_SKIP_REASON });
    console.log(`SKIPPED: ${NATHAN_SKIP_REASON}. The item is marked checked.`);
    return;
  }
  const before = await readItem(itemId);
  // A video is always read, even with stored text, because its caption cues
  // are what give each note its time in the video.
  const read = before.full_text && !isVideo(before.url) ? null : await fetchAndStoreItemText(itemId, { keepText: Boolean(before.full_text) });
  const item = await readItem(itemId);
  const dir = postDir(item.url);
  mkdirSync(dir, { recursive: true });
  if (read?.cues) writeFileSync(path.join(dir, "cues.json"), JSON.stringify(read.cues));
  const creator = item.project?.name ?? "unknown";
  writeFileSync(path.join(dir, "post.md"), `# ${item.title ?? item.url}\n\nBy ${creator}, published ${item.published_at}\n${item.url}\n\n${item.full_text ?? ""}`);
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ itemId: item.id, url: item.url, title: item.title, creator, publishedAt: item.published_at }, null, 2));
  await logEvent({ actor: "claude", type: "item_taken", itemId });
  console.log(dir);
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
    const items = writer === "claude" ? await waitingItems() : [];
    if (items.length > 0) return print({ wake: "queue", items: items.map(({ full_text, ...item }) => item) });
    if (Date.now() - startedAt > DIGEST_EVERY_MS) return print({ wake: "digest" });
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
    case "skip":
      return logEvent({ actor: "claude", type: "item_skipped", itemId: arg(0), data: { reason: args.slice(1).join(" ") } });
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
