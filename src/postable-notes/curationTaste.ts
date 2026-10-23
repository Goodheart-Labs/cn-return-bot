/**
 * Writes the team's curation of the best notes as one Markdown file, for the
 * daily postable-notes job to read before it judges new notes (GOO-555). It
 * holds the leaderboard in the team's order and the recommendations they
 * removed, each note with the passage it is on and the team's comment or
 * reason under it.
 *
 *   bun run curation-taste [--out <file>]   # default: standard output
 *
 * It reads the production database through SUPABASE_URL and
 * SUPABASE_SERVICE_KEY.
 */

import "dotenv/config";
import * as fs from "fs";
import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows, fetchInBatches } from "../everything-core/paging";

const db = getSupabaseClient();

interface LeaderboardRow {
  note_id: string;
  position: number;
  comment: string | null;
  posted_at: string | null;
}

interface RemovedRow {
  note_id: string;
  removed_at: string;
  removed_reason: string | null;
  comment: string | null;
}

interface NoteContext {
  id: string;
  note: string;
  claim: { context_quote: string | null; claim: string; item: { title: string | null; url: string; project: { name: string } | null } };
}

async function fetchNoteContexts(noteIds: string[]): Promise<Map<string, NoteContext>> {
  const notes = await fetchInBatches<NoteContext>(
    (ids) =>
      db
        .from("everything_notes")
        .select("id, note, claim:everything_claims!inner(context_quote, claim, item:everything_items!inner(title, url, project:everything_projects(name)))")
        .in("id", ids),
    noteIds,
    "id",
  );
  return new Map(notes.map((note) => [note.id, note]));
}

const quote = (text: string) => text.trim().split("\n").map((line) => `> ${line}`).join("\n");

/** One note as a block: where it is, the passage, the note, and then whatever
 *  the team said about it. A note deleted from the site is left out. */
function noteBlock(heading: string, context: NoteContext | undefined, said: string[]): string {
  if (!context) return "";
  const { item } = context.claim;
  const where = `${item.project?.name ?? "Around the web"}, [${item.title ?? item.url}](${item.url})`;
  return [`### ${heading}`, where, "", "Passage:", quote(context.claim.context_quote ?? context.claim.claim), "", "Note:", quote(context.note), "", ...said, ""].join("\n");
}

async function main() {
  const leaderboard = (
    await fetchAllRows<LeaderboardRow>(() => db.from("everything_best_notes").select("note_id, position, comment, posted_at"), "note_id")
  ).sort((a, b) => a.position - b.position);
  const removed = (
    await fetchAllRows<RemovedRow>(
      () => db.from("everything_note_recommendations").select("note_id, removed_at, removed_reason, comment").not("removed_at", "is", null),
      "note_id",
    )
  ).sort((a, b) => b.removed_at.localeCompare(a.removed_at));
  const contexts = await fetchNoteContexts([...leaderboard, ...removed].map((row) => row.note_id));

  const sections = [
    "# The team's taste in notes",
    "",
    `Generated from the admins' curation at commonnotes.net/admin/best by \`bun run curation-taste\`, ${new Date().toISOString().slice(0, 10)}. Do not edit it by hand.`,
    "",
    "Jim and Nathan move Claude's recommended notes to their own leaderboard, in the order they think best, or remove them, and say why. Read the comments and reasons as the best evidence of what they want: which errors matter to them, and which notes they find pedantic, confused or not needed.",
    "",
    `## Our leaderboard (${leaderboard.length} notes, best first)`,
    "",
    ...leaderboard.map((row, i) =>
      noteBlock(`${i + 1}.${row.posted_at ? " (posted on X)" : ""}`, contexts.get(row.note_id), row.comment ? [`Their comment: ${row.comment}`] : []),
    ),
    `## Removed from the recommendations (${removed.length} notes, most recent first)`,
    "",
    ...removed.map((row) =>
      noteBlock(
        `Removed ${row.removed_at.slice(0, 10)}`,
        contexts.get(row.note_id),
        [`Their reason: ${row.removed_reason ?? "none given"}`, ...(row.comment ? [`Their earlier comment: ${row.comment}`] : [])],
      ),
    ),
  ];
  const text = sections.join("\n");
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined;
  if (out) fs.writeFileSync(out, text);
  else console.log(text);
}

await main();
