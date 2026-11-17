/* Builds the labelled notes for the note judge experiment (GOO-588) from
 * prod and writes them to data/dataset.json, oldest first.
 *
 * The notes are every note the Claude note writer posted or that Jim or
 * Nathan rejected. Jim's labels, from 2026-10-26:
 * - Helpful: rated helpful overall, or Helpful or Somewhat helpful votes and
 *   no Not-helpful vote.
 * - Not helpful: rejected by Jim or Nathan, rated not helpful overall, or
 *   Not-helpful votes and no Helpful or Somewhat helpful vote.
 * Notes that fit neither, which are mostly notes nobody voted on, are left
 * out. The author's own automatic Helpful vote does not count.
 *
 * Usage: bun run src/scripts_jim/2026_10_26_note_judge/buildDataset.ts */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { noteTally } from "../../everything-core/noteBelief";
import { noteStatus } from "../../everything-core/noteScore";
import { fetchAllRows, fetchInBatches } from "../../everything-core/paging";
import { DATA_DIR, DATASET_PATH, type LabelledNote } from "./dataFiles";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function unwrap<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(JSON.stringify(error));
  return data as T;
}

interface Draft {
  id: string;
  item_id: string;
  passage: string;
  context_paragraph: string | null;
  note: string;
  sources: { url: string; quote: string; explanation: string }[];
  status: string;
  note_id: string | null;
  created_at: string;
  item: { url: string; title: string | null; project: { name: string } | null };
}
interface Tally {
  id: string;
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  author_id: string | null;
}

function label(draft: Draft, tally: Tally | undefined): { outcome: LabelledNote["outcome"]; why: string } | null {
  if (draft.status === "rejected") return { outcome: "not_helpful", why: "rejected" };
  if (!tally) return null;
  const status = noteStatus(tally);
  if (status === "helpful") return { outcome: "helpful", why: "rated helpful" };
  if (status === "not_helpful") return { outcome: "not_helpful", why: "rated not helpful" };
  const votes = noteTally(tally);
  const upvotes = votes.helpful + votes.somewhatHelpful;
  if (upvotes > 0 && votes.notHelpful === 0) return { outcome: "helpful", why: "only upvotes" };
  if (votes.notHelpful > 0 && upvotes === 0) return { outcome: "not_helpful", why: "only downvotes" };
  return null;
}

/** The reviewers' and voters' own words: the rejection reason, or the
 *  reasoning someone gave with their vote. Few votes carry any. */
async function reviewerReasons(drafts: Draft[]): Promise<Map<string, string>> {
  const reasons = new Map<string, string>();
  const rejections = await fetchAllRows<{ id: number; draft_id: string; data: { reason?: string } }>(
    () => db.from("everything_claude_events").select("id, draft_id, data").eq("type", "rejected"),
    "id",
  );
  for (const r of rejections) {
    if (r.data.reason) reasons.set(r.draft_id, r.data.reason);
  }
  const draftByNote = new Map(drafts.filter((d) => d.note_id).map((d) => [d.note_id!, d.id]));
  const votes = await fetchInBatches<{ id: string; note_id: string; reasoning: string }>(
    (chunk) => db.from("everything_votes").select("id, note_id, reasoning").in("note_id", chunk).not("reasoning", "is", null),
    [...draftByNote.keys()],
    "id",
  );
  for (const v of votes) {
    const draftId = draftByNote.get(v.note_id)!;
    reasons.set(draftId, [reasons.get(draftId), v.reasoning].filter(Boolean).join(" "));
  }
  return reasons;
}

async function main() {
  const drafts = await fetchAllRows<Draft>(
    () =>
      db
        .from("everything_claude_drafts")
        .select("id, item_id, passage, context_paragraph, note, sources, status, note_id, created_at, item:everything_items(url, title, project:everything_projects(name))")
        .eq("outcome", "note")
        .in("status", ["posted", "rejected"]),
    "id",
  );
  const tallies = await fetchInBatches<Tally>(
    (chunk) => db.from("everything_notes").select("id, helpful_count, somewhat_helpful_count, not_helpful_count, author_id").in("id", chunk),
    drafts.flatMap((d) => (d.note_id ? [d.note_id] : [])),
    "id",
  );
  const tallyById = new Map(tallies.map((t) => [t.id, t]));
  const leaderboard = new Set(((await unwrap(db.from("everything_best_notes").select("note_id"))) as { note_id: string }[]).map((r) => r.note_id));
  const reasons = await reviewerReasons(drafts);

  const unordered: Omit<LabelledNote, "fewShotRole">[] = drafts.flatMap((d) => {
    const result = label(d, d.note_id ? tallyById.get(d.note_id) : undefined);
    if (!result) return [];
    return [
      {
        draftId: d.id,
        noteId: d.note_id,
        createdAt: d.created_at,
        outcome: result.outcome,
        labelWhy: result.why,
        reason: reasons.get(d.id) ?? null,
        onLeaderboard: !!d.note_id && leaderboard.has(d.note_id),
        post: { title: d.item.title, url: d.item.url, creator: d.item.project?.name ?? null },
        passage: d.passage,
        contextParagraph: d.context_paragraph,
        note: d.note,
        sources: d.sources,
      },
    ];
  });
  unordered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const half = Math.floor(unordered.length / 2);
  const labelled: LabelledNote[] = unordered.map((n, i) => ({ ...n, fewShotRole: i < half ? "example" : "judged" }));

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATASET_PATH, JSON.stringify(labelled, null, 1));
  const count = (why: string) => labelled.filter((n) => n.labelWhy === why).length;
  console.log(`${drafts.length} posted or rejected notes, ${labelled.length} labelled:`);
  for (const why of ["rated helpful", "only upvotes", "rated not helpful", "only downvotes", "rejected"]) console.log(`  ${why}: ${count(why)}`);
  console.log(`  with a reviewer's reason: ${labelled.filter((n) => n.reason).length}`);
}

await main();
