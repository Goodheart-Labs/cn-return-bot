/** Collects the notes to rank for the best notes list (GOO-529): the notes the
 *  postable-notes job suggested, Nathan's and Jim's notes written with Claude
 *  Code, and the live notes of the automatic Claude note writer.
 *    bun collect.ts <posted.txt> <candidates.json> <out.json> */
import "dotenv/config";
import * as fs from "fs";
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows, fetchInBatches } from "../../everything-core/paging";

const [postedFile, candidatesFile, outFile] = process.argv.slice(2);
const TEAM = { "0e97e940-652f-466b-8693-c142257e083d": "jim", "963d0c31-33e5-47da-8aa1-386bc3289efb": "nathan" } as Record<string, string>;
const CLAUDE_CODE_START = "2026-10-13";
const db = getSupabaseClient();

const source = new Map<string, string>();
for (const line of fs.readFileSync(postedFile, "utf8").split("\n")) if (line.trim()) source.set(line.split(" ")[0], "suggested");
for (const c of JSON.parse(fs.readFileSync(candidatesFile, "utf8"))) if (c.author === "NathanpmYoung" && !source.has(c.noteId)) source.set(c.noteId, "nathan");
const teamNotes = await fetchAllRows<{ id: string; author_id: string }>(
  () => db.from("everything_notes").select("id, author_id").in("author_id", Object.keys(TEAM)).gte("created_at", CLAUDE_CODE_START), "id");
for (const n of teamNotes) if (!source.has(n.id)) source.set(n.id, TEAM[n.author_id]);
const drafts = await fetchAllRows<{ id: string; note_id: string | null }>(
  () => db.from("everything_claude_drafts").select("id, note_id").not("note_id", "is", null), "id");
for (const d of drafts) if (d.note_id && !source.has(d.note_id)) source.set(d.note_id, "claude_writer");

type Row = { id: string; note: string; status: string; helpful_count: number; somewhat_helpful_count: number; not_helpful_count: number;
  claim: { context_quote: string | null; context_paragraph: string | null; item: { title: string | null; url: string; project: { name: string; slug: string } | null } } };
const rows = await fetchInBatches<Row>((ids) =>
  db.from("everything_notes").select("id, note, status, helpful_count, somewhat_helpful_count, not_helpful_count, claim:everything_claims!inner(context_quote, context_paragraph, item:everything_items!inner(title, url, project:everything_projects(name, slug)))").in("id", ids), [...source.keys()], "id");
const out = rows.filter((r) => r.status !== "hidden").map((r) => ({
  noteId: r.id, source: source.get(r.id), creator: r.claim.item.project?.name, title: r.claim.item.title, url: r.claim.item.url,
  passage: r.claim.context_quote, paragraph: r.claim.context_paragraph, note: r.note,
  votes: `${r.helpful_count} H, ${r.somewhat_helpful_count} S, ${r.not_helpful_count} NH`,
}));
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
const counts: Record<string, number> = {};
for (const o of out) counts[o.source!] = (counts[o.source!] ?? 0) + 1;
console.log(out.length, "of", source.size, counts);
