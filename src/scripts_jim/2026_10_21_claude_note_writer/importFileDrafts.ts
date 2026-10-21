// Moves the note-finding agents' file drafts of GOO-504 and their review log
// into the prod tables of migration 129 (GOO-507), keeping every timestamp.
// Notes Jim accepted stay posted as JimMaar1 and count as approved by Jim.
// Notes nobody looked at yet are posted as AI notes, as Jim allowed.
// Run once: bun run src/scripts_jim/2026_10_21_claude_note_writer/importFileDrafts.ts
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../everything-core/database.types";
import { publish } from "../../claude-notes/store";

const WORK_DIR = `${homedir()}/.local/share/claude-note-finder`;
const WITHDRAWN_PREFIX = "Withdrawn by Claude";
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

interface FileDraft {
  itemId: string;
  passage: string;
  claim: string;
  kind: string;
  outcome: string;
  note: string;
  reasoning: string;
  sources: unknown[];
  review?: { decision: "accepted" | "rejected"; at: string; reason?: string; noteId?: string };
  feedback?: { at: string; comment: string; answer?: { at: string; reply: string } }[];
}
interface LogLine {
  type: string;
  at: string;
  file: string;
  note: string;
  [key: string]: unknown;
}

type EventInsert = Database["public"]["Tables"]["everything_claude_events"]["Insert"];

function draftStatus(d: FileDraft, withdrawn: boolean) {
  if (withdrawn || d.outcome !== "note") return "not_a_note";
  if (d.review?.decision === "accepted") return "posted";
  if (d.review?.decision === "rejected") return "rejected";
  return "awaiting_approval";
}

/** The log of GOO-504 as events. Chat messages and answers come from the draft
 *  files, because the log only kept the comments. */
function eventsOf(file: string, d: FileDraft, draftId: string, log: LogLine[]): EventInsert[] {
  const base = { draft_id: draftId, item_id: d.itemId };
  const chat = (d.feedback ?? []).flatMap((f) => [
    { ...base, at: f.at, actor: "jim", type: "message", data: { text: f.comment, imported: true } },
    ...(f.answer ? [{ ...base, at: f.answer.at, actor: "claude", type: "answer", data: { text: f.answer.reply, imported: true } }] : []),
  ]);
  const steps = log
    .filter((l) => l.file === file && l.type !== "feedback")
    .map((l) => {
      const { type, at, file: _file, ...rest } = l;
      const renamed = type === "accepted" ? "approved" : type === "revised" ? "rewritten" : type;
      const actor = type === "accepted" || type === "rejected" ? "jim" : "claude";
      return { ...base, at, actor, type: renamed, note_id: (rest.noteId as string) ?? null, data: { ...rest, imported: true } as Json };
    });
  return [...chat, ...steps];
}

const log: LogLine[] = readFileSync(`${WORK_DIR}/review-log.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const files = readdirSync(`${WORK_DIR}/drafts`).filter((f) => f.endsWith(".json")).sort();
let toPost: string[] = [];
for (const file of files) {
  const d: FileDraft = JSON.parse(readFileSync(`${WORK_DIR}/drafts/${file}`, "utf8"));
  const withdrawn = d.reasoning.startsWith(WITHDRAWN_PREFIX);
  const status = draftStatus(d, withdrawn);
  const firstAt = log.find((l) => l.file === file)?.at ?? d.review?.at ?? new Date().toISOString();
  const { data: row, error } = await db
    .from("everything_claude_drafts")
    .insert({
      item_id: d.itemId,
      passage: d.passage,
      claim: d.claim,
      kind: d.kind,
      outcome: withdrawn ? "withdrawn" : d.outcome,
      note: d.note,
      reasoning: d.reasoning,
      sources: d.sources as Json,
      status,
      note_id: d.review?.decision === "accepted" ? d.review.noteId : null,
      posted_as: d.review?.decision === "accepted" ? "jim" : null,
      reviewed_by: d.review ? "jim" : null,
      reviewed_at: d.review?.at ?? null,
      created_at: firstAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(`${file}: ${JSON.stringify(error)}`);
  const events = [{ draft_id: row.id, item_id: d.itemId, at: firstAt, actor: "claude", type: "draft_written", data: { file, imported: true } as Json }, ...eventsOf(file, d, row.id, log)];
  const { error: eventError } = await db.from("everything_claude_events").insert(events);
  if (eventError) throw new Error(`${file} events: ${JSON.stringify(eventError)}`);
  if (status === "posted" && d.review?.noteId) {
    const { data: note } = await db.from("everything_notes").select("claim_id").eq("id", d.review.noteId).single();
    if (note) await db.from("everything_claims").update({ judgement: "claude_code" }).eq("id", note.claim_id);
  }
  if (status === "awaiting_approval") toPost = [...toPost, row.id];
}
console.log(`Imported ${files.length} drafts. Posting ${toPost.length} unreviewed notes as AI notes`);
for (const id of toPost) {
  const { data: draft } = await db.from("everything_claude_drafts").select("*").eq("id", id).single();
  await publish(draft!, "ai", "claude");
}
console.log("Done");
