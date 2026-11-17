// Writes docs/note-examples.md, the judged examples in the system prompt of
// every Claude that writes Common Notes (GOO-504, GOO-507, GOO-612).
// Everything comes from prod: Nathan's Claude Code notes, which Jim judged
// very good, Nathan's votes on other notes, and
// every decision Jim and Nathan made on the Claude note writer's notes in the
// review page, with the rewrites their messages led to. Nathan's ratings
// from his own review page of 20 and 21 October come from a stored table.
// Regenerating never drops an entry: an entry of the old file that prod no
// longer yields, for example a vote on a note we have since deleted, is kept.
//
// Usage: bun run claude-notes examples

import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { fetchAllRows, fetchInBatches } from "../everything-core/paging";

const NATHAN_USER_ID = "963d0c31-33e5-47da-8aa1-386bc3289efb";
/** Nathan posted his Claude Code batch on 2026-10-21 between 00:19 and 01:00
 *  UTC. His earlier notes are hand-written. */
const CLAUDE_CODE_BATCH_START = "2026-10-21T00:00:00Z";
// The runner on ai-box keeps its own copy outside the checkout, because the
// checkout pulls main every few minutes and must stay clean.
const EXAMPLES_PATH = process.env.CN_EXAMPLES_PATH ?? new URL("../../docs/note-examples.md", import.meta.url).pathname;
const REVIEW_HEADING = "## Jim's and Nathan's review decisions";
const RATINGS_HEADING = "## Nathan's ratings on his own review page (2026-10-20 and 21)";
/** The export of Nathan's local review page, one row per card he scored,
 *  commented on, edited or posted. */
const NATHAN_RATINGS_PATH = new URL("./examples/nathan-ratings-2026-10-20-21.csv", import.meta.url).pathname;
const MAX_RATING = 5;
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
  const votes = await fetchAllRows<{ id: string; note_id: string; vote: number; reasoning: string | null }>(
    () => db.from("everything_votes").select("id, note_id, vote, reasoning").eq("voter_id", NATHAN_USER_ID),
    "id",
  );
  const notes = await fetchInBatches<{ id: string; note: string; author_id: string | null; claim: unknown }>(
    (chunk) => db.from("everything_notes").select(NOTE_COLUMNS).in("id", chunk).neq("author_id", NATHAN_USER_ID),
    votes.map((v) => v.note_id),
    "id",
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
  review_note: string | null;
  item: { url: string; title: string | null };
}
interface ReviewEvent {
  draft_id: string;
  at: string;
  actor: string;
  type: string;
  data: Record<string, string>;
}

/** What each review step is called in an entry's heading. Since migration 143
 *  a vote of Jim or Nathan is the review, and "rejected" is the old button. */
const VERDICT_WORDS: Record<string, string> = { approved: "approved", disapproved: "disapproved", rejected: "rejected", deleted: "deleted from the site" };

/** One entry per reviewer step that teaches something: an approval, a
 *  disapproval or a deletion with the reviewers' shared note, and a rewrite
 *  with the message that asked for it. */
async function reviewDecisions(): Promise<string[]> {
  const events = (
    await fetchAllRows<ReviewEvent & { id: number }>(
      () => db.from("everything_claude_events").select("id, draft_id, at, actor, type, data").in("type", [...Object.keys(VERDICT_WORDS), "rewritten", "message"]).not("draft_id", "is", null),
      "id",
    )
  ).sort((a, b) => a.id - b.id);
  const draftIds = [...new Set(events.map((e) => e.draft_id))];
  const drafts = await fetchInBatches<ReviewedDraft>(
    (chunk) => db.from("everything_claude_drafts").select("id, passage, note, status, review_note, item:everything_items(url, title)").in("id", chunk),
    draftIds,
    "id",
  );
  const draftById = new Map(drafts.map((d) => [d.id, d]));
  let lastMessage = new Map<string, ReviewEvent>();
  const entries: string[] = [];
  for (const e of events) {
    const d = draftById.get(e.draft_id);
    if (!d) continue;
    const claim = { claim: d.passage, context_quote: d.passage, item: d.item };
    if (e.type === "message") lastMessage = new Map(lastMessage).set(e.draft_id, e);
    else if (VERDICT_WORDS[e.type]) {
      // Jim's and Nathan's shared note on the draft says why it is good or bad.
      const reason = e.data.reason || d.review_note;
      entries.push(noteSection(`${PERSON[e.actor]} ${VERDICT_WORDS[e.type]} (${e.at.slice(0, 10)})`, claim, e.data.note ?? d.note, reason ? `\nThe reviewers' note: ${reason}` : ""));
    } else if (e.type === "rewritten") {
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

interface RatingRow {
  card: string;
  kind: string;
  post: string;
  post_url: string;
  claim: string;
  note_shown: string;
  nathan_score: string;
  nathan_comments: string;
  claude_replies: string;
  nathan_final_edit: string;
  posted: string;
}

/** One entry per card Nathan scored or commented on. Re-check cards rate a note
 *  that was already live. */
function nathanRatings(): string[] {
  const rows = Papa.parse<RatingRow>(readFileSync(NATHAN_RATINGS_PATH, "utf8"), { header: true, skipEmptyLines: true }).data;
  return rows
    .filter((r) => r.nathan_score || r.nathan_comments || r.nathan_final_edit)
    .map((r) => {
      const score = r.nathan_score ? `scored ${r.nathan_score}/${MAX_RATING}` : "commented";
      const recheck = r.kind.startsWith("re-check") ? ", re-check of a live note" : "";
      const claim = { claim: r.claim, context_quote: r.claim, item: { url: r.post_url, title: r.post } };
      const extra = [
        r.nathan_comments && `\nNathan's comment:\n${quoteBlock(r.nathan_comments)}`,
        r.claude_replies && `\nClaude's reply:\n${quoteBlock(r.claude_replies)}`,
        r.nathan_final_edit && `\nNathan's edit:\n${quoteBlock(r.nathan_final_edit)}`,
        `\nPosted: ${r.posted || "no"}`,
      ]
        .filter(Boolean)
        .join("\n");
      return noteSection(`Nathan ${score} (${r.card}${recheck})`, claim, r.note_shown, extra);
    });
}

/** An entry's identity: its heading, its post line and its passage. The note
 *  text is left out, because a later rewrite changes it in a regenerated entry. */
function entryKey(entry: string): string {
  const passageEnd = entry.indexOf("\nNote:");
  return passageEnd < 0 ? entry : entry.slice(0, passageEnd);
}

/** The entries of each `## ` section of the current file, by section heading. */
function previousEntries(): Map<string, string[]> {
  if (!existsSync(EXAMPLES_PATH)) return new Map();
  const sections = readFileSync(EXAMPLES_PATH, "utf8").split(/\n(?=## )/).slice(1);
  return new Map(
    sections.map((section) => {
      const heading = section.slice(0, section.indexOf("\n"));
      const entries = section.split(/\n(?=### )/).slice(1).map((e) => e.trim());
      return [heading, entries];
    }),
  );
}

/** The new entries plus every old entry of the same section they no longer
 *  contain. */
function keepOld(heading: string, entries: string[], previous: Map<string, string[]>): string[] {
  const keys = new Set(entries.map(entryKey));
  return [...entries, ...(previous.get(heading) ?? []).filter((e) => !keys.has(entryKey(e)))];
}

const GOOD_HEADING = "## Nathan's Claude Code notes (all judged very good by Jim)";
const VOTES_HEADING = "## Nathan's votes on other notes";
const previous = previousEntries();
const [goodNew, votesNew, notNeeded, decisionsNew] = await Promise.all([nathanNotes(), nathanVotes(), nathanNotNeeded(), reviewDecisions()]);
const good = keepOld(GOOD_HEADING, goodNew, previous);
const votes = keepOld(VOTES_HEADING, [...votesNew, ...notNeeded], previous);
const decisions = keepOld(REVIEW_HEADING, decisionsNew, previous);
const ratings = keepOld(RATINGS_HEADING, nathanRatings(), previous);
const document = `# What makes a good Common Note

This file collects judged examples of notes on our Common Notes items. Every Claude that writes Common Notes, or answers a reviewer about one, gets it in its system prompt. It is generated from prod by \`bun run claude-notes examples\` (\`src/claude-notes/buildExamples.ts\`). Do not edit it by hand.

${GOOD_HEADING}

Nathan wrote these with Claude Code on 2026-10-21, checked each one, and posted it.

${good.join("\n\n")}

${VOTES_HEADING}

${votes.join("\n\n")}

${REVIEW_HEADING}

Every approval and rejection in the review page, and every rewrite a reviewer's message led to, oldest first. The rewrites show the length and directness Jim and Nathan want.

${decisions.join("\n\n")}

${RATINGS_HEADING}

Nathan scored notes from 1 (bad) to 5 (very good) on his own review page, and commented on some of them.

${ratings.join("\n\n")}
`;

writeFileSync(EXAMPLES_PATH, document);
console.log(`Wrote ${EXAMPLES_PATH}: ${good.length} good examples, ${votes.length} votes and no-note entries, ${decisions.length} review decisions, ${ratings.length} ratings`);
