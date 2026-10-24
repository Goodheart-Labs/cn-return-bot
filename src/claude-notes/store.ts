/* The Claude note writer's data (GOO-507). A permanent Claude Code session
 * writes Common Notes with subagents instead of the pipeline. Its drafts, its
 * settings and the log of every step live in prod, in the tables of migration
 * 129, so the admins' review page on commonnotes.net and the Claude session
 * see the same state. Everything here runs with the service key on the
 * devbox, never in a browser. Posting, rewriting and removing a note happen in
 * the SQL functions of migration 130, which the review page calls too. */

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
export type Settings = { writer: Writer; approvalRequired: boolean; postsInFlight: number; updatedAt: string; updatedBy: string };

/** NathanpmYoung's account, whose notes on a post make Claude skip the post. */
const NATHAN_ACCOUNT_ID = "963d0c31-33e5-47da-8aa1-386bc3289efb";
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
  const row = unwrap(await db().from("everything_claude_settings").select("writer, approval_required, posts_in_flight, updated_at, updated_by").single());
  return { writer: row.writer as Writer, approvalRequired: row.approval_required, postsInFlight: row.posts_in_flight, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

export type SettingsChange = { writer?: Writer; approvalRequired?: boolean; postsInFlight?: number };

export async function changeSettings(actor: Actor, change: SettingsChange) {
  check(
    await db().rpc("everything_claude_change_settings", {
      p_writer: change.writer,
      p_approval_required: change.approvalRequired,
      p_posts_in_flight: change.postsInFlight,
      p_actor: actor,
    }),
  );
}

// ---------------------------------------------------------------------------
// Where a passage sits in its post
// ---------------------------------------------------------------------------

/** Where `take` writes a post's text, and a video's caption cues, for the
 *  note-finding agents. */
const POSTS_DIR = path.join(homedir(), ".local/share/claude-note-finder/posts");

export function postDir(url: string): string {
  return path.join(POSTS_DIR, url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 80).replace(/-$/, ""));
}

export const isVideo = (url: string) => extractYoutubeVideoId(url) !== null;

/** Where a claim sits in a video: its seconds and a link that starts the
 *  video there. The extension pins a video's notes on the player by these.
 *  A draft stores it, and the database copies it onto the note's claim. */
interface VideoTiming {
  start_seconds: number | null;
  end_seconds: number | null;
  context_url: string;
}

/** Finds the passage in the video's caption cues, which `take` saved next to
 *  the post's text. Null when the item is no video or no cues are saved. */
function videoTiming(url: string, passage: string): VideoTiming | null {
  const videoId = extractYoutubeVideoId(url);
  const cuesPath = path.join(postDir(url), "cues.json");
  if (!videoId || !existsSync(cuesPath)) return null;
  const cues: SubtitleCue[] = JSON.parse(readFileSync(cuesPath, "utf8"));
  const { start, end } = contextTimeSpan(passage, cues);
  if (start === undefined) return null;
  return { start_seconds: Math.floor(start), end_seconds: end === undefined ? null : Math.ceil(end), context_url: buildVideoLink(videoId, start) };
}

/** A paragraph longer than this, such as a whole video transcript, is cut to a
 *  window of CONTEXT_WINDOW_CHARS around the passage. */
const MAX_PARAGRAPH_CHARS = 3_000;
const CONTEXT_WINDOW_CHARS = 1_500;
/** An agent's passage sometimes leaves out a footnote marker inside it, so a
 *  paragraph that holds only the passage's opening words counts too. */
const PASSAGE_OPENING_CHARS = 40;

/** The paragraph of the post that contains the passage, which the review page
 *  shows beside the note. */
export function contextParagraph(postText: string | null, passage: string): string | null {
  if (!postText) return null;
  const paragraphs = postText.split(/\n\s*\n/);
  const opening = passage.slice(0, PASSAGE_OPENING_CHARS);
  const paragraph = paragraphs.find((p) => p.includes(passage)) ?? paragraphs.find((p) => p.includes(opening));
  if (!paragraph || paragraph.length <= MAX_PARAGRAPH_CHARS) return paragraph ?? null;
  const passageStart = Math.max(0, paragraph.indexOf(opening));
  const start = paragraph.lastIndexOf(" ", Math.max(0, passageStart - CONTEXT_WINDOW_CHARS / 2)) + 1;
  const end = paragraph.indexOf(" ", passageStart + passage.length + CONTEXT_WINDOW_CHARS / 2);
  return `${start > 0 ? "… " : ""}${paragraph.slice(start, end < 0 ? undefined : end)}${end < 0 ? "" : " …"}`;
}

/** Where a passage sits in its post: its paragraph and, in a video, its time. */
async function placeOfPassage(itemId: string, passage: string) {
  const item = unwrap(await db().from("everything_items").select("url, full_text").eq("id", itemId).single());
  return { context_paragraph: contextParagraph(item.full_text, passage), video_timing: videoTiming(item.url, passage) as Json | null };
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
        // A note that goes up at once is saved as waiting, and posting it
        // marks it posted. If posting fails, the note waits for approval
        // instead of looking posted.
        status: status === "posted" ? "awaiting_approval" : status,
        ...(await placeOfPassage(draft.itemId, draft.passage)),
      })
      .select("*")
      .single(),
  );
  await logEvent({ actor: "claude", type: "draft_written", draftId: row.id, itemId: row.item_id, data: { outcome: row.outcome, note: row.note } });
  if (status !== "posted") return row;
  await publishAsAi(row.id, "claude");
  return readDraft(row.id);
}

/** Posts a draft's note on commonnotes.net as an AI note. */
export async function publishAsAi(draftId: string, actor: Actor) {
  check(await db().rpc("everything_claude_publish", { p_draft: draftId, p_posted_as: "ai", p_actor: actor }));
}

export async function readDraft(draftId: string): Promise<DraftRow> {
  return unwrap(await db().from("everything_claude_drafts").select("*").eq("id", draftId).single());
}

/** Claude replaces a draft's note text after a reviewer's message. A posted
 *  note is replaced on the site under the same account. A new passage gets
 *  its paragraph and video time worked out again. */
export async function rewrite(draftId: string, change: { note: string; sources?: DraftSource[]; passage?: string; reason: string }): Promise<DraftRow> {
  const place = change.passage ? await placeOfPassage((await readDraft(draftId)).item_id, change.passage) : null;
  check(
    await db().rpc("everything_claude_rewrite", {
      p_draft: draftId,
      p_note: change.note,
      p_reason: change.reason,
      p_sources: change.sources as unknown as Json,
      p_passage: change.passage,
      p_context_paragraph: place?.context_paragraph ?? undefined,
      p_video_timing: place?.video_timing ?? undefined,
      p_actor: "claude",
    }),
  );
  return readDraft(draftId);
}

/** Claude takes back a note it no longer stands behind. */
export async function withdraw(draftId: string, reason: string): Promise<DraftRow> {
  check(await db().rpc("everything_claude_withdraw", { p_draft: draftId, p_reason: reason, p_actor: "claude" }));
  return readDraft(draftId);
}

/** Claude's answer to a reviewer's chat message. */
export async function answerMessage(draftId: string, text: string) {
  check(await db().rpc("everything_claude_message", { p_draft: draftId, p_text: text, p_actor: "claude" }));
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
  published_at: string | null;
  created_at: string;
}

/** The pipeline's order, so both writers agree: the highest tier first, then
 *  items without a published date, then the newest, then the oldest in the
 *  queue. */
function inPipelineOrder(a: QueueItem, b: QueueItem): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.published_at !== b.published_at) {
    if (a.published_at === null) return -1;
    if (b.published_at === null) return 1;
    return a.published_at < b.published_at ? 1 : -1;
  }
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/** The queue as the Claude note writer sees it. `waiting` holds the queued
 *  items Claude has neither taken nor handed back. `taken` holds the ones
 *  Claude took and has not finished yet: an item Claude works on stays queued
 *  until it is finished, so the take event is what tells it apart. */
export async function claudeQueue(): Promise<{ waiting: QueueItem[]; taken: QueueItem[] }> {
  const queued = await fetchAllRows<QueueItem>(
    () => db().from("everything_items").select("id, url, title, priority, status, published_at, created_at").eq("status", "queued"),
    "id",
    { label: "queued items" },
  );
  const ids = queued.map((item) => item.id);
  const [handbacks, takes] = await Promise.all([
    fetchInBatches<{ item_id: string }>((chunk) => db().from("everything_claude_handbacks").select("item_id").in("item_id", chunk), ids, "item_id", { label: "claude handbacks" }),
    fetchInBatches<{ id: number; item_id: string }>(
      (chunk) => db().from("everything_claude_events").select("id, item_id").eq("type", "item_taken").in("item_id", chunk),
      ids,
      "id",
      { label: "claude takes" },
    ),
  ]);
  const handedBack = new Set(handbacks.map((h) => h.item_id));
  const taken = new Set(takes.map((e) => e.item_id));
  const mine = queued.filter((item) => !handedBack.has(item.id)).sort(inPipelineOrder);
  return { waiting: mine.filter((item) => !taken.has(item.id)), taken: mine.filter((item) => taken.has(item.id)) };
}

export async function readItem(itemId: string): Promise<QueueItem & { full_text: string | null; project: { name: string; slug: string } | null }> {
  return unwrap(
    await db()
      .from("everything_items")
      .select("id, url, title, priority, status, full_text, published_at, created_at, project:everything_projects(name, slug)")
      .eq("id", itemId)
      .single(),
  ) as never;
}

/** Whether Nathan already wrote notes on this post. Jim asked that such posts
 *  be skipped as a whole: Nathan fact-checked them by hand. */
export async function nathanNotedItem(itemId: string): Promise<boolean> {
  const claims = unwrap(await db().from("everything_claims").select("everything_notes(author_id)").eq("item_id", itemId));
  return claims.some((c) => (c.everything_notes ?? []).some((n) => n.author_id === NATHAN_ACCOUNT_ID));
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

/** Marks an item checked without notes, because nothing in it is worth
 *  checking, such as a music video or a game trailer. */
export async function skipItem(itemId: string, reason: string) {
  await logEvent({ actor: "claude", type: "item_skipped", itemId, data: { reason } });
  await finishItem(itemId, { skipped: true, reason });
}

/** How many drafts Claude saved on an item since a time. */
export async function claudeDraftsSince(itemId: string, since: string): Promise<number> {
  const { count, error } = await db().from("everything_claude_drafts").select("id", { count: "exact", head: true }).eq("item_id", itemId).gte("created_at", since);
  if (error) throw new Error(JSON.stringify(error));
  return count ?? 0;
}

/** The notes Claude posted since a time, newest first, for the daily review
 *  on Nathan's ai-box. Withdrawn and rejected notes are not posted, so they
 *  are left out. */
export async function postedSince(since: string) {
  return fetchAllRows<{ id: string; note_id: string | null; created_at: string; passage: string; note: string; item: { url: string; title: string | null; project: { slug: string } | null } | null }>(
    () =>
      db()
        .from("everything_claude_drafts")
        .select("id, note_id, created_at, passage, note, item:everything_items(url, title, project:everything_projects(slug))")
        .eq("status", "posted")
        .gte("created_at", since),
    "id",
    { label: "posted drafts" },
  ).then((rows) => rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
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
  const note = unwrap(await db().from("everything_notes").select("id, note, claim_id, author_id, everything_claims(item_id, judgement)").eq("id", noteId).single());
  if (note.author_id !== null) throw new Error(`Note ${noteId} was written by a person, not by the pipeline`);
  if (note.everything_claims?.item_id !== itemId) throw new Error(`Note ${noteId} is not on item ${itemId}`);
  if (note.everything_claims.judgement === CLAUDE_JUDGEMENT) throw new Error(`Note ${noteId} is the Claude note writer's own note. Use withdraw for it`);
  check(await db().from("everything_notes").delete().eq("id", noteId));
  check(await db().from("everything_claims").update({ status: "no_note", status_reason: `Note removed by the Claude note writer: ${reason}` }).eq("id", note.claim_id));
  await logEvent({ actor: "claude", type: "pipeline_note_deleted", itemId, noteId, data: { reason, note: note.note } });
}
