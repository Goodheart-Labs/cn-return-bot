// Writes docs/note-examples.md, the judged examples the note-finding agents
// read first (GOO-504, GOO-507). Everything comes from prod: Nathan's Claude
// Code notes, which Jim judged very good, Nathan's votes on other notes, and
// every decision Jim and Nathan made on the Claude note writer's notes in the
// review page, with the rewrites their messages led to.
//
// Usage: bun run claude-notes examples

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const NATHAN_USER_ID = "963d0c31-33e5-47da-8aa1-386bc3289efb";
/** Nathan posted his Claude Code batch on 2026-10-21 between 00:19 and 01:00
 *  UTC. His earlier notes are hand-written. */
const CLAUDE_CODE_BATCH_START = "2026-10-21T00:00:00Z";
const EXAMPLES_PATH = new URL("../../docs/note-examples.md", import.meta.url).pathname;
const REVIEW_HEADING = "## Jim's and Nathan's review decisions";
const PERSON: Record<string, string> = { jim: "Jim", nathan: "Nathan", claude: "Claude" };
const VOTE_LABELS: Record<number, string> = { 1: "Helpful", 0: "Somewhat helpful", [-1]: "Not helpful" };

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function unwrap<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(JSON.stringify(error));
  return data as T;
}

interface ClaimContext {
  claim: string;
  context_quote: string | null;
  item: { url: string; title: string | null };
}

const NOTE_COLUMNS = "id, note, author_id, created_at, claim:everything_claims(claim, context_quote, item:everything_items(url, title))";

function quoteBlock(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function noteSection(heading: string, claim: ClaimContext, note: string, extra = ""): string {
  return [
    `### ${heading}`,
    `Post: [${claim.item.title ?? claim.item.url}](${claim.item.url})`,
    "",
    "Passage:",
    quoteBlock(claim.context_quote ?? claim.claim),
    "",
    "Note:",
    quoteBlock(note),
    extra,
  ].join("\n");
}

async function nathanNotes(): Promise<string[]> {
  const notes = await unwrap(
    db.from("everything_notes").select(NOTE_COLUMNS).eq("author_id", NATHAN_USER_ID).gte("created_at", CLAUDE_CODE_BATCH_START).order("created_at"),
  );
  return notes.map((n, i) => noteSection(`Good example ${i + 1}`, n.claim as unknown as ClaimContext, n.note));
}

async function nathanVotes(): Promise<string[]> {
  const votes = await unwrap(db.from("everything_votes").select("note_id, vote, reasoning").eq("voter_id", NATHAN_USER_ID));
  const notes = await unwrap(
    db
      .from("everything_notes")
      .select(NOTE_COLUMNS)
      .in("id", votes.map((v) => v.note_id))
      .neq("author_id", NATHAN_USER_ID),
  );
  const noteById = new Map(notes.map((n) => [n.id, n]));
  // Not helpful first, because those are the clearest lessons.
  return votes
    .filter((v) => noteById.has(v.note_id))
    .sort((a, b) => a.vote - b.vote)
    .map((v) => {
      const n = noteById.get(v.note_id)!;
      const author = n.author_id ? "a person" : "our pipeline";
      const reasoning = v.reasoning ? `\nNathan's reason: ${v.reasoning}` : "";
      return noteSection(`Nathan rated ${VOTE_LABELS[v.vote]} (note by ${author})`, n.claim as unknown as ClaimContext, n.note, reasoning);
    });
}

async function nathanNotNeeded(): Promise<string[]> {
  const entries = await unwrap(
    db.from("everything_note_not_needed").select("body, claim:everything_claims(claim, context_quote, item:everything_items(url, title))").eq("author_id", NATHAN_USER_ID),
  );
  return entries.map((e) => noteSection("Nathan wrote that no note is needed", e.claim as unknown as ClaimContext, e.body));
}

interface ReviewedDraft {
  id: string;
  passage: string;
  note: string;
  status: string;
  item: { url: string; title: string | null };
}
interface ReviewEvent {
  draft_id: string;
  at: string;
  actor: string;
  type: string;
  data: Record<string, string>;
}

/** One entry per reviewer step that teaches something: an approval, a
 *  rejection with its reason, and a rewrite with the message that asked for it. */
async function reviewDecisions(): Promise<string[]> {
  const events = await unwrap<ReviewEvent[]>(
    db.from("everything_claude_events").select("draft_id, at, actor, type, data").in("type", ["approved", "rejected", "rewritten", "message"]).not("draft_id", "is", null).order("id"),
  );
  const draftIds = [...new Set(events.map((e) => e.draft_id))];
  const drafts = await unwrap<ReviewedDraft[]>(db.from("everything_claude_drafts").select("id, passage, note, status, item:everything_items(url, title)").in("id", draftIds) as never);
  const draftById = new Map(drafts.map((d) => [d.id, d]));
  let lastMessage = new Map<string, ReviewEvent>();
  const entries: string[] = [];
  for (const e of events) {
    const d = draftById.get(e.draft_id);
    if (!d) continue;
    const claim = { claim: d.passage, context_quote: d.passage, item: d.item };
    if (e.type === "message") lastMessage = new Map(lastMessage).set(e.draft_id, e);
    else if (e.type === "approved") entries.push(noteSection(`${PERSON[e.actor]} approved (${e.at.slice(0, 10)})`, claim, e.data.note ?? d.note));
    else if (e.type === "rejected")
      entries.push(noteSection(`${PERSON[e.actor]} rejected (${e.at.slice(0, 10)})`, claim, e.data.note ?? d.note, e.data.reason ? `\n${PERSON[e.actor]}'s reason: ${e.data.reason}` : ""));
    else if (e.type === "rewritten") {
      const previous = e.data.previous_note ?? e.data.previousNote;
      const asked = lastMessage.get(e.draft_id);
      if (!previous || !asked) continue;
      entries.push(
        [
          `### Rewritten after ${PERSON[asked.actor]}'s comment (${e.at.slice(0, 10)})`,
          `Post: [${d.item.title ?? d.item.url}](${d.item.url})`,
          "",
          "Passage:",
          quoteBlock(d.passage),
          "",
          "Earlier version:",
          quoteBlock(previous),
          "",
          `${PERSON[asked.actor]}'s comment:`,
          quoteBlock(asked.data.text ?? ""),
          "",
          "New version:",
          quoteBlock(e.data.note ?? d.note),
        ].join("\n"),
      );
    }
  }
  return entries;
}

const [good, votes, notNeeded, decisions] = await Promise.all([nathanNotes(), nathanVotes(), nathanNotNeeded(), reviewDecisions()]);
const document = `# What makes a good Common Note

This file collects judged examples of notes on our Common Notes items. Agents that look for noteworthy passages and write notes read it first. It is generated from prod by \`bun run claude-notes examples\` (\`src/claude-notes/buildExamples.ts\`). Do not edit it by hand.

A good note points out something a careful reader would want to know: a small factual mistake, missing context that makes a passage easy to misread, or a claim that is wrong or misleading. It is short, neutral, and every sentence is backed by a cited source.

## Nathan's Claude Code notes (all judged very good by Jim)

Nathan wrote these with Claude Code on 2026-10-21, checked each one, and posted it.

${good.join("\n\n")}

## Nathan's votes on other notes

${votes.join("\n\n")}

${notNeeded.join("\n\n")}

${REVIEW_HEADING}

Every approval and rejection in the review page, and every rewrite a reviewer's message led to, oldest first. The rewrites show the length and directness Jim and Nathan want.

${decisions.join("\n\n")}
`;

writeFileSync(EXAMPLES_PATH, document);
console.log(`Wrote ${EXAMPLES_PATH}: ${good.length} good examples, ${votes.length} votes, ${notNeeded.length} no-note entries, ${decisions.length} review decisions`);
