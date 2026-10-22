/* The Claude note writer's data (GOO-507). A permanent Claude Code session
 * writes Common Notes with subagents instead of the pipeline. Its drafts, its
 * settings and the log of every step live in prod, in the tables of migration
 * 129, so the note review dashboards of Jim and Nathan and the Claude session
 * all see the same state. Everything here runs with the service key, on the
 * devbox or in a reviewer's local dashboard server, never in a browser. */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";
import { ENV_DIR } from "../cnEnv";
import type { Database, Json } from "../everything-core/database.types";
import { fetchAllRows, fetchInBatches } from "../everything-core/paging";
import { extractYoutubeVideoId } from "../everything-core/pageUrls";
import { buildVideoLink, contextTimeSpan } from "../everything/pipeline/extractClaims";
import type { SubtitleCue } from "../pipeline/media/youtubeCaptions";

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

/** Where `take` writes a post's text, and a video's caption cues, for the
 *  note-finding agents. */
const POSTS_DIR = path.join(homedir(), ".local/share/claude-note-finder/posts");

export function postDir(url: string): string {
  return path.join(POSTS_DIR, url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 80).replace(/-$/, ""));
}

export const isVideo = (url: string) => extractYoutubeVideoId(url) !== null;

/** Where a claim sits in a video: its seconds and a link that starts the
 *  video there. The extension pins a video's notes on the player by these. */
interface VideoTiming {
  start_seconds: number | null;
  end_seconds: number | null;
  context_url: string;
}

/** Finds the passage in the video's caption cues, which `take` saved next to
 *  the post's text. Null when the item is no video or no cues are saved, for
 *  example on a reviewer's own machine. */
function videoTiming(url: string, passage: string): VideoTiming | null {
  const videoId = extractYoutubeVideoId(url);
  const cuesPath = path.join(postDir(url), "cues.json");
  if (!videoId || !existsSync(cuesPath)) return null;
  const cues: SubtitleCue[] = JSON.parse(readFileSync(cuesPath, "utf8"));
  const { start, end } = contextTimeSpan(passage, cues);
  if (start === undefined) return null;
  return { start_seconds: Math.floor(start), end_seconds: end === undefined ? null : Math.ceil(end), context_url: buildVideoLink(videoId, start) };
}

/** Creates a claim on the draft's passage and posts the note on it, with one
 *  source row per supporting quote. Returns the new note's id. */
async function postNote(draft: DraftRow, postedAs: PostedAs, timing: VideoTiming | null): Promise<string> {
  const account = postedAs === "ai" ? null : ACCOUNTS[postedAs];
  const url = await itemUrl(draft.item_id);
  const claim = unwrap(
    await db()
      .from("everything_claims")
      .insert({
        item_id: draft.item_id,
        claim: draft.passage.slice(0, CLAIM_PREVIEW_CHARS),
        judgement: CLAUDE_JUDGEMENT,
        context_quote: draft.passage,
        context_url: url,
        ...(timing ?? videoTiming(url, draft.passage)),
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

async function claimTiming(noteId: string): Promise<VideoTiming | null> {
  const note = unwrap(await db().from("everything_notes").select("claim:everything_claims(start_seconds, end_seconds, context_url)").eq("id", noteId).single());
  const claim = note.claim as unknown as VideoTiming | null;
  return claim?.start_seconds === null || !claim ? null : claim;
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

/** Two passages count as the same place when one contains the other or they
 *  share this many characters in a row. */
const SHARED_PASSAGE_CHARS = 40;

const normalizedPassage = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

export function passagesOverlap(a: string, b: string): boolean {
  const [x, y] = [normalizedPassage(a), normalizedPassage(b)];
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  for (let i = 0; i + SHARED_PASSAGE_CHARS <= shorter.length; i += SHARED_PASSAGE_CHARS / 2) {
    if (longer.includes(shorter.slice(i, i + SHARED_PASSAGE_CHARS))) return true;
  }
  return false;
}

/** A note a person wrote on the same passage of this post, if there is one.
 *  Claude never posts a second note where Jim, Nathan or a reader already
 *  wrote one. */
async function personNoteOnPassage(itemId: string, passage: string): Promise<{ note: string; author_name: string | null } | null> {
  const claims = unwrap(
    await db().from("everything_claims").select("context_quote, claim, everything_notes(note, author_id, author_name)").eq("item_id", itemId),
  );
  for (const c of claims) {
    const personNote = (c.everything_notes ?? []).find((n) => n.author_id !== null);
    if (personNote && passagesOverlap(c.context_quote ?? c.claim, passage)) return personNote;
  }
  return null;
}

/** Saves what a note-finding agent found on one passage. A note is posted as
 *  an AI note at once, unless notes currently wait for approval. */
export async function addDraft(draft: NewDraft): Promise<DraftRow> {
  const covering = draft.outcome === "note" ? await personNoteOnPassage(draft.itemId, draft.passage) : null;
  if (covering) {
    draft = {
      ...draft,
      outcome: "no_note_needed",
      reasoning: `Not posted, because ${covering.author_name ?? "a person"} already wrote a note on this passage: "${covering.note}" ${draft.reasoning}`,
    };
  }
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
export async function publish(draft: DraftRow, postedAs: PostedAs, actor: Actor, timing: VideoTiming | null = null): Promise<DraftRow> {
  const noteId = await postNote(draft, postedAs, timing);
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

/** Approving a note counts as the reviewer's Helpful vote, the same vote a
 *  note's author gets automatically on the website. */
const HELPFUL = 1;
async function voteHelpful(noteId: string, by: Exclude<Actor, "claude">) {
  check(await db().from("everything_votes").upsert({ note_id: noteId, voter_id: ACCOUNTS[by].id, vote: HELPFUL }, { onConflict: "note_id,voter_id" }));
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
  if (row.note_id) await voteHelpful(row.note_id, by);
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
  // A rewrite keeps the old claim's place in a video, so it also works on a
  // reviewer's machine, which has no caption cues. A new passage is placed anew.
  const timing = change.passage ? null : await claimTiming(draft.note_id);
  await removeClaudeNote(draft.note_id);
  return publish(updated, change.postedAs ?? (draft.posted_as as PostedAs), change.actor, timing);
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
  const rows = await fetchAllRows<DraftRow>(() => db().from("everything_claude_drafts").select("*"), "id", { label: "claude drafts" });
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Every logged step that belongs to one of the given drafts, oldest first. */
export async function eventsOfDrafts(draftIds: string[]): Promise<EventRow[]> {
  const rows = await fetchInBatches<EventRow>((chunk) => db().from("everything_claude_events").select("*").in("draft_id", chunk), draftIds, "id", { label: "claude draft events" });
  return rows.sort((a, b) => a.id - b.id);
}

/** Reviewer messages Claude has not answered yet, oldest first. A message is
 *  answered once an answer to the same draft was logged after it. */
export async function unansweredMessages(): Promise<EventRow[]> {
  const rows = (
    await fetchAllRows<EventRow>(() => db().from("everything_claude_events").select("*").in("type", ["message", "answer"]), "id", { label: "claude chat events" })
  ).sort((a, b) => a.id - b.id);
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

/** Queued items Claude has neither taken nor handed back, highest tier first.
 *  An item Claude is working on stays queued until it is finished, so the
 *  take is what tells it apart. */
export async function waitingItems(): Promise<QueueItem[]> {
  const [handbacks, takes] = await Promise.all([
    fetchAllRows<{ item_id: string }>(() => db().from("everything_claude_handbacks").select("item_id"), "item_id", { label: "claude handbacks" }),
    fetchAllRows<{ id: number; item_id: string }>(() => db().from("everything_claude_events").select("id, item_id").eq("type", "item_taken"), "id", { label: "claude takes" }),
  ]);
  const handedBack = new Set(handbacks.map((h) => h.item_id));
  const taken = new Set(takes.map((e) => e.item_id));
  const queued = unwrap(
    await db().from("everything_items").select("id, url, title, priority, status, full_text").eq("status", "queued").order("priority", { ascending: false }).order("created_at"),
  );
  return queued.filter((item) => !handedBack.has(item.id) && !taken.has(item.id));
}

export async function readItem(itemId: string): Promise<QueueItem & { project: { name: string; slug: string } | null; published_at: string | null }> {
  return unwrap(
    await db().from("everything_items").select("id, url, title, priority, status, full_text, published_at, project:everything_projects(name, slug)").eq("id", itemId).single(),
  ) as never;
}

const itemTextCache = new Map<string, { url: string; title: string | null; creator: string; fullText: string | null }>();

/** The address, title, creator and text of each item. A post's text does not
 *  change once it is checked, so the dashboard's server reads each item once. */
export async function readItemTexts(itemIds: string[]) {
  const missing = itemIds.filter((id) => !itemTextCache.has(id));
  const rows = await fetchInBatches<{ id: string; url: string; title: string | null; full_text: string | null; project: { name: string } | null }>(
    (chunk) => db().from("everything_items").select("id, url, title, full_text, project:everything_projects(name)").in("id", chunk),
    missing,
    "id",
    { label: "claude draft items" },
  );
  for (const r of rows) itemTextCache.set(r.id, { url: r.url, title: r.title, creator: r.project?.name ?? "", fullText: r.full_text });
  return new Map(itemIds.map((id) => [id, itemTextCache.get(id)!]));
}

/** Whether Nathan already wrote notes on this post. Jim asked that such posts
 *  be skipped as a whole: Nathan fact-checked them by hand. */
export async function nathanNotedItem(itemId: string): Promise<boolean> {
  const claims = unwrap(await db().from("everything_claims").select("everything_notes(author_id)").eq("item_id", itemId));
  return claims.some((c) => (c.everything_notes ?? []).some((n) => n.author_id === ACCOUNTS.nathan.id));
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
