/* The Claude note writer's data (GOO-507). A permanent Claude Code session
 * writes Common Notes with subagents instead of the pipeline. Its drafts, its
 * settings and the log of every step live in prod, in the tables of migration
 * 129, so the note review dashboards of Jim and Nathan and the Claude session
 * all see the same state. Everything here runs with the service key, on the
 * devbox or in a reviewer's local dashboard server, never in a browser. */

import * as path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";
import { ENV_DIR } from "../cnEnv";
import type { Database, Json } from "../everything-core/database.types";

export type Actor = "jim" | "nathan" | "claude";
export type PostedAs = "ai" | "jim" | "nathan";
export type Writer = "pipeline" | "claude";

export interface DraftSource {
  url: string;
  quote: string;
  explanation: string;
}

export interface NewDraft {
  itemId: string;
  passage: string;
  claim: string;
  kind: "small_mistake" | "missing_context" | "wrong_or_misleading";
  outcome: "note" | "no_note_needed" | "too_hard";
  note: string;
  reasoning: string;
  sources: DraftSource[];
}

export type DraftRow = Database["public"]["Tables"]["everything_claude_drafts"]["Row"];
export type EventRow = Database["public"]["Tables"]["everything_claude_events"]["Row"];
export type Settings = { writer: Writer; approvalRequired: boolean; updatedAt: string; updatedBy: string };

/** The account ids notes are posted under when a reviewer picks a person. An
 *  AI note has no account, like the pipeline's notes. */
const ACCOUNTS: Record<Exclude<PostedAs, "ai">, { id: string; name: string }> = {
  jim: { id: "0e97e940-652f-466b-8693-c142257e083d", name: "JimMaar1" },
  nathan: { id: "963d0c31-33e5-47da-8aa1-386bc3289efb", name: "NathanpmYoung" },
};
/** A claim keeps only a preview of its passage in `claim`, as on the website
 *  (postNote.ts). The full passage is the claim's context_quote. */
const CLAIM_PREVIEW_CHARS = 300;
/** Marks the claims the Claude note writer created, so they can be told apart
 *  from the pipeline's ratings and from readers' own notes ("user"). */
const CLAUDE_JUDGEMENT = "claude_code";

let client: SupabaseClient<Database> | undefined;
function db(): SupabaseClient<Database> {
  if (!client) {
    loadDotenv({ path: path.join(ENV_DIR, ".env"), quiet: true });
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in the root .env");
    client = createClient<Database>(url, key);
  }
  return client;
}

/** For a query that returns rows. */
function unwrap<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw new Error(JSON.stringify(error));
  if (data === null || data === undefined) throw new Error("The query returned no data");
  return data as NonNullable<T>;
}

/** For a write that returns nothing. */
function check({ error }: { error: unknown }) {
  if (error) throw new Error(JSON.stringify(error));
}

export async function logEvent(event: { actor: Actor; type: string; draftId?: string; itemId?: string; noteId?: string; data?: Record<string, unknown> }) {
  check(
    await db()
      .from("everything_claude_events")
      .insert({ actor: event.actor, type: event.type, draft_id: event.draftId, item_id: event.itemId, note_id: event.noteId, data: (event.data ?? {}) as Json }),
  );
}

export async function readSettings(): Promise<Settings> {
  const row = unwrap(await db().from("everything_claude_settings").select("writer, approval_required, updated_at, updated_by").single());
  return { writer: row.writer as Writer, approvalRequired: row.approval_required, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

export async function changeSettings(actor: Actor, change: { writer?: Writer; approvalRequired?: boolean }) {
  const update = {
    ...(change.writer && { writer: change.writer }),
    ...(change.approvalRequired !== undefined && { approval_required: change.approvalRequired }),
    updated_at: new Date().toISOString(),
    updated_by: actor,
  };
  check(await db().from("everything_claude_settings").update(update).eq("id", true));
  await logEvent({ actor, type: "settings_changed", data: change });
}

// ---------------------------------------------------------------------------
// Posting and removing notes on commonnotes.net
// ---------------------------------------------------------------------------

async function itemUrl(itemId: string): Promise<string> {
  return unwrap(await db().from("everything_items").select("url").eq("id", itemId).single()).url;
}

/** Creates a claim on the draft's passage and posts the note on it, with one
 *  source row per supporting quote. Returns the new note's id. */
async function postNote(draft: DraftRow, postedAs: PostedAs): Promise<string> {
  const account = postedAs === "ai" ? null : ACCOUNTS[postedAs];
  const claim = unwrap(
    await db()
      .from("everything_claims")
      .insert({
        item_id: draft.item_id,
        claim: draft.passage.slice(0, CLAIM_PREVIEW_CHARS),
        judgement: CLAUDE_JUDGEMENT,
        context_quote: draft.passage,
        context_url: await itemUrl(draft.item_id),
        status: "note",
        created_by: account?.id ?? null,
      })
      .select("id")
      .single(),
  );
  const note = unwrap(
    await db()
      .from("everything_notes")
      .insert({ claim_id: claim.id, note: draft.note, author_id: account?.id ?? null, author_name: account?.name ?? null })
      .select("id")
      .single(),
  );
  const sources = (draft.sources as unknown as DraftSource[]).map((s, i) => ({ note_id: note.id, url: s.url, quote: s.quote, explanation: s.explanation, sort_order: i }));
  if (sources.length > 0) check(await db().from("everything_note_sources").insert(sources));
  return note.id;
}

/** Removes a note the Claude note writer posted, together with the claim it
 *  created for it. Votes, sources and comments go with the note. */
async function removeClaudeNote(noteId: string) {
  const { claim_id } = unwrap(await db().from("everything_notes").select("claim_id").eq("id", noteId).single());
  check(await db().from("everything_claims").delete().eq("id", claim_id).eq("judgement", CLAUDE_JUDGEMENT));
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

/** Saves what a note-finding agent found on one passage. A note is posted as
 *  an AI note at once, unless notes currently wait for approval. */
export async function addDraft(draft: NewDraft): Promise<DraftRow> {
  const { approvalRequired } = await readSettings();
  const status = draft.outcome !== "note" ? "not_a_note" : approvalRequired ? "awaiting_approval" : "posted";
  const row = unwrap(
    await db()
      .from("everything_claude_drafts")
      .insert({
        item_id: draft.itemId,
        passage: draft.passage,
        claim: draft.claim,
        kind: draft.kind,
        outcome: draft.outcome,
        note: draft.note,
        reasoning: draft.reasoning,
        sources: draft.sources as unknown as Json,
        status,
      })
      .select("*")
      .single(),
  );
  await logEvent({ actor: "claude", type: "draft_written", draftId: row.id, itemId: row.item_id, data: { outcome: row.outcome, note: row.note } });
  return status === "posted" ? publish(row, "ai", "claude") : row;
}

/** Posts a draft's note on commonnotes.net and records it as posted. */
export async function publish(draft: DraftRow, postedAs: PostedAs, actor: Actor): Promise<DraftRow> {
  const noteId = await postNote(draft, postedAs);
  const row = unwrap(
    await db()
      .from("everything_claude_drafts")
      .update({ status: "posted", note_id: noteId, posted_as: postedAs, updated_at: new Date().toISOString() })
      .eq("id", draft.id)
      .select("*")
      .single(),
  );
  await logEvent({ actor, type: "posted", draftId: draft.id, itemId: draft.item_id, noteId, data: { posted_as: postedAs, note: draft.note } });
  return row;
}

export async function readDraft(draftId: string): Promise<DraftRow> {
  return unwrap(await db().from("everything_claude_drafts").select("*").eq("id", draftId).single());
}

/** Jim or Nathan keeps a note. A note that waited for approval goes up now. */
export async function approve(draftId: string, by: Exclude<Actor, "claude">): Promise<DraftRow> {
  let draft = await readDraft(draftId);
  if (draft.outcome !== "note") throw new Error("Only a note can be approved");
  if (draft.status === "awaiting_approval") draft = await publish(draft, "ai", by);
  const row = unwrap(
    await db()
      .from("everything_claude_drafts")
      .update({ reviewed_by: by, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", draftId)
      .select("*")
      .single(),
  );
  await logEvent({ actor: by, type: "approved", draftId, itemId: draft.item_id, noteId: draft.note_id ?? undefined });
  return row;
}

/** Jim or Nathan turns a note down. A posted note is deleted from the site. */
export async function reject(draftId: string, by: Exclude<Actor, "claude">, reason: string): Promise<DraftRow> {
  const draft = await readDraft(draftId);
  if (draft.note_id) await removeClaudeNote(draft.note_id);
  const row = unwrap(
    await db()
      .from("everything_claude_drafts")
      .update({ status: "rejected", note_id: null, reviewed_by: by, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", draftId)
      .select("*")
      .single(),
  );
  await logEvent({ actor: by, type: "rejected", draftId, itemId: draft.item_id, noteId: draft.note_id ?? undefined, data: { reason, note: draft.note } });
  return row;
}

/** Replaces a draft's note text. A posted note is replaced on the site: the new
 *  text goes up under `postedAs` and the old note is deleted. */
export async function rewrite(
  draftId: string,
  change: { actor: Actor; note: string; sources?: DraftSource[]; passage?: string; postedAs?: PostedAs; reason: string },
): Promise<DraftRow> {
  const draft = await readDraft(draftId);
  const updated = unwrap(
    await db()
      .from("everything_claude_drafts")
      .update({
        note: change.note,
        outcome: "note",
        ...(change.sources && { sources: change.sources as unknown as Json }),
        ...(change.passage && { passage: change.passage }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId)
      .select("*")
      .single(),
  );
  await logEvent({
    actor: change.actor,
    type: "rewritten",
    draftId,
    itemId: draft.item_id,
    data: { reason: change.reason, previous_note: draft.note, previous_sources: draft.sources, previous_passage: draft.passage, note: change.note },
  });
  if (draft.status !== "posted" || !draft.note_id) return updated;
  await removeClaudeNote(draft.note_id);
  return publish(updated, change.postedAs ?? (draft.posted_as as PostedAs), change.actor);
}

/** Claude takes back a note it no longer stands behind. */
export async function withdraw(draftId: string, reason: string): Promise<DraftRow> {
  const draft = await readDraft(draftId);
  if (draft.note_id) await removeClaudeNote(draft.note_id);
  const row = unwrap(
    await db()
      .from("everything_claude_drafts")
      .update({ outcome: "withdrawn", status: "not_a_note", note_id: null, updated_at: new Date().toISOString() })
      .eq("id", draftId)
      .select("*")
      .single(),
  );
  await logEvent({ actor: "claude", type: "withdrawn", draftId, itemId: draft.item_id, noteId: draft.note_id ?? undefined, data: { reason, note: draft.note } });
  return row;
}

/** A chat message from a reviewer, or Claude's answer to one. */
export async function addMessage(draftId: string, actor: Actor, text: string) {
  const draft = await readDraft(draftId);
  await logEvent({ actor, type: actor === "claude" ? "answer" : "message", draftId, itemId: draft.item_id, data: { text } });
}

export async function listDrafts(): Promise<DraftRow[]> {
  return unwrap(await db().from("everything_claude_drafts").select("*").order("created_at"));
}

/** Every logged step that belongs to one of the given drafts, oldest first. */
export async function eventsOfDrafts(draftIds: string[]): Promise<EventRow[]> {
  if (draftIds.length === 0) return [];
  return unwrap(await db().from("everything_claude_events").select("*").in("draft_id", draftIds).order("id"));
}

/** Reviewer messages Claude has not answered yet, oldest first. A message is
 *  answered once an answer to the same draft was logged after it. */
export async function unansweredMessages(): Promise<EventRow[]> {
  const rows = unwrap(await db().from("everything_claude_events").select("*").in("type", ["message", "answer"]).order("id"));
  const lastAnswer = new Map<string, number>();
  for (const r of rows) if (r.type === "answer" && r.draft_id) lastAnswer.set(r.draft_id, r.id);
  return rows.filter((r) => r.type === "message" && r.draft_id && r.id > (lastAnswer.get(r.draft_id) ?? 0));
}

// ---------------------------------------------------------------------------
// Items: what the note writer takes from the queue, and what it gives back
// ---------------------------------------------------------------------------

export interface QueueItem {
  id: string;
  url: string;
  title: string | null;
  priority: number;
  status: string;
  full_text: string | null;
}

/** Queued items Claude has not handed back, highest tier first. */
export async function waitingItems(): Promise<QueueItem[]> {
  const handedBack = new Set(unwrap(await db().from("everything_claude_handbacks").select("item_id")).map((h) => h.item_id));
  const queued = unwrap(
    await db().from("everything_items").select("id, url, title, priority, status, full_text").eq("status", "queued").order("priority", { ascending: false }).order("created_at"),
  );
  return queued.filter((item) => !handedBack.has(item.id));
}

export async function readItem(itemId: string): Promise<QueueItem & { project: { name: string; slug: string } | null; published_at: string | null }> {
  return unwrap(
    await db().from("everything_items").select("id, url, title, priority, status, full_text, published_at, project:everything_projects(name, slug)").eq("id", itemId).single(),
  ) as never;
}

/** How many item ids go into one `in` filter, so the request URL stays short. */
const IDS_PER_REQUEST = 100;
const itemTextCache = new Map<string, { url: string; title: string | null; creator: string; fullText: string | null }>();

/** The address, title, creator and text of each item. A post's text does not
 *  change once it is checked, so the dashboard's server reads each item once. */
export async function readItemTexts(itemIds: string[]) {
  const missing = itemIds.filter((id) => !itemTextCache.has(id));
  for (let i = 0; i < missing.length; i += IDS_PER_REQUEST) {
    const rows = unwrap(
      await db().from("everything_items").select("id, url, title, full_text, project:everything_projects(name)").in("id", missing.slice(i, i + IDS_PER_REQUEST)),
    );
    for (const r of rows) {
      const project = r.project as unknown as { name: string } | null;
      itemTextCache.set(r.id, { url: r.url, title: r.title, creator: project?.name ?? "", fullText: r.full_text });
    }
  }
  return new Map(itemIds.map((id) => [id, itemTextCache.get(id)!]));
}

/** Gives an item back to the pipeline, which then processes it as before. */
export async function handBack(itemId: string, reason: string) {
  check(await db().from("everything_claude_handbacks").upsert({ item_id: itemId, reason }));
  await logEvent({ actor: "claude", type: "handed_back", itemId, data: { reason } });
}

/** Marks an item checked once Claude's agents went through all of it. */
export async function finishItem(itemId: string, summary: Record<string, unknown>) {
  check(
    await db()
      .from("everything_items")
      .update({ status: "done", checked_scope: "page", skip_reason: null, processed_at: new Date().toISOString() })
      .eq("id", itemId),
  );
  await logEvent({ actor: "claude", type: "item_finished", itemId, data: summary });
}

// ---------------------------------------------------------------------------
// The pipeline's own notes on a post, which Claude judges after its own pass
// ---------------------------------------------------------------------------

export async function pipelineNotes(itemId: string) {
  const claims = unwrap(
    await db().from("everything_claims").select("id, claim, context_quote, judgement, everything_notes(id, note, author_id, helpful_count, somewhat_helpful_count, not_helpful_count)").eq("item_id", itemId),
  );
  return claims
    .filter((c) => c.judgement !== CLAUDE_JUDGEMENT)
    .flatMap((c) => (c.everything_notes ?? []).filter((n) => n.author_id === null).map((n) => ({ claimId: c.id, passage: c.context_quote ?? c.claim, ...n })));
}

export async function keepPipelineNote(itemId: string, noteId: string, reason: string) {
  await logEvent({ actor: "claude", type: "pipeline_note_kept", itemId, noteId, data: { reason } });
}

/** Deletes a pipeline note Claude judged bad. Its votes go with it, as Jim
 *  decided. The claim stays, marked as having no note. */
export async function deletePipelineNote(itemId: string, noteId: string, reason: string) {
  const note = unwrap(await db().from("everything_notes").select("id, note, claim_id, author_id").eq("id", noteId).single());
  if (note.author_id !== null) throw new Error(`Note ${noteId} was written by a person, not by the pipeline`);
  check(await db().from("everything_notes").delete().eq("id", noteId));
  check(await db().from("everything_claims").update({ status: "no_note", status_reason: `Note removed by the Claude note writer: ${reason}` }).eq("id", note.claim_id));
  await logEvent({ actor: "claude", type: "pipeline_note_deleted", itemId, noteId, data: { reason, note: note.note } });
}
