// Writes the part of docs/note-examples.md that comes from prod: Nathan's
// Claude Code notes, which Jim judged very good, and Nathan's votes on other
// notes. Jim's own accept and reject decisions are appended below it by the
// review dashboard, so this script keeps everything after REVIEW_LOG_MARKER.
//
// Usage: bun run src/scripts_jim/2026_10_21_claude_note_finder/buildNoteExamples.ts

import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const NATHAN_USER_ID = "963d0c31-33e5-47da-8aa1-386bc3289efb";
/** Nathan posted his Claude Code batch on 2026-10-21 between 00:19 and 01:00
 *  UTC. His earlier notes are hand-written. */
const CLAUDE_CODE_BATCH_START = "2026-10-21T00:00:00Z";
const EXAMPLES_PATH = "docs/note-examples.md";
export const REVIEW_LOG_MARKER = "## Jim's review decisions";
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

const existing = existsSync(EXAMPLES_PATH) ? readFileSync(EXAMPLES_PATH, "utf8") : "";
const reviewLog = existing.includes(REVIEW_LOG_MARKER)
  ? existing.slice(existing.indexOf(REVIEW_LOG_MARKER))
  : `${REVIEW_LOG_MARKER}\n\nThe review dashboard appends each note Jim accepts or rejects here, newest last.\n`;

const [good, votes, notNeeded] = await Promise.all([nathanNotes(), nathanVotes(), nathanNotNeeded()]);
const document = `# What makes a good Common Note

This file collects judged examples of notes on our Common Notes items. Agents that look for noteworthy passages and write notes read it first. The parts above "${REVIEW_LOG_MARKER}" are generated from prod by \`src/scripts_jim/2026_10_21_claude_note_finder/buildNoteExamples.ts\`. Do not edit them by hand.

A good note points out something a careful reader would want to know: a small factual mistake, missing context that makes a passage easy to misread, or a claim that is wrong or misleading. It is short, neutral, and every sentence is backed by a cited source.

## Nathan's Claude Code notes (all judged very good by Jim)

Nathan wrote these with Claude Code on 2026-10-21, checked each one, and posted it.

${good.join("\n\n")}

## Nathan's votes on other notes

${votes.join("\n\n")}

${notNeeded.join("\n\n")}

${reviewLog}`;

writeFileSync(EXAMPLES_PATH, document);
console.log(`Wrote ${EXAMPLES_PATH}: ${good.length} good examples, ${votes.length} votes, ${notNeeded.length} no-note entries`);
