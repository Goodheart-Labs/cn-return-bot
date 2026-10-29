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
import type { NoteTallyFields } from "../everything-core/noteBelief";
import { noteStatus } from "../everything-core/noteScore";
import { CLAUDE_CODE_BOT } from "../pipeline/orchestration/claudeTweets";
import { shuffled, type JudgedNote, type JudgeExample, type Judgement } from "./judge";
import type { ClaudeRunTag } from "./usageShare";

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
export type Settings = { writer: Writer; updatedAt: string; updatedBy: string };

/** NathanpmYoung's account, whose notes on a post make Claude skip the post. */
const NATHAN_ACCOUNT_ID = "963d0c31-33e5-47da-8aa1-386bc3289efb";

let client: SupabaseClient<Database> | undefined;
export function db(): SupabaseClient<Database> {
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
  const row = unwrap(await db().from("everything_claude_settings").select("writer, updated_at, updated_by").single());
  return { writer: row.writer as Writer, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

export async function changeWriter(actor: Actor, writer: Writer) {
  check(await db().rpc("everything_claude_change_settings", { p_writer: writer, p_actor: actor }));
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
 *  an AI note at once. */
export async function addDraft(draft: NewDraft): Promise<DraftRow> {
  const covering = draft.outcome === "note" ? await personNoteOnPassage(draft.itemId, draft.passage) : null;
  if (covering) {
    draft = {
      ...draft,
      outcome: "no_note_needed",
      reasoning: `Not posted, because ${covering.author_name ?? "a person"} already wrote a note on this passage: "${covering.note}" ${draft.reasoning}`,
    };
  }
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
        // A note is saved as posting, and posting it marks it posted. If
        // posting fails, the draft stays visible under Not reviewed instead
        // of looking posted.
        status: draft.outcome === "note" ? "posting" : "not_a_note",
        run_id: process.env[RUN_ID_ENV] ?? null,
        ...(await placeOfPassage(draft.itemId, draft.passage)),
      })
      .select("*")
      .single(),
  );
  await logEvent({ actor: "claude", type: "draft_written", draftId: row.id, itemId: row.item_id, data: { outcome: row.outcome, note: row.note } });
  if (draft.outcome !== "note") return row;
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

/** Claude proposes a better text of a draft's note after a reviewer's
 *  message. The review page shows it, and a reviewer posts it in place of the
 *  note (migration 143). Without new sources the note's own are kept. */
export async function propose(draftId: string, change: { note: string; sources?: DraftSource[]; reason: string }) {
  const sources = change.sources ?? (await readDraft(draftId)).sources;
  check(
    await db().rpc("everything_claude_propose", {
      p_draft: draftId,
      p_note: change.note,
      p_sources: sources as unknown as Json,
      p_reason: change.reason,
      p_actor: "claude",
    }),
  );
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
 *  items Claude has not taken. `taken` holds the ones Claude took and has not
 *  finished yet: an item Claude works on stays queued until it is finished, so
 *  the take event is what tells it apart. A post Claude failed on can come
 *  back to the queue when the walk tries it again, so only a take newer than
 *  the item's last failure counts. */
export async function claudeQueue(): Promise<{ waiting: QueueItem[]; taken: QueueItem[] }> {
  const queued = await fetchAllRows<QueueItem>(
    () => db().from("everything_items").select("id, url, title, priority, status, published_at, created_at").eq("status", "queued"),
    "id",
    { label: "queued items" },
  );
  const events = await fetchInBatches<{ id: number; item_id: string; type: string }>(
    (chunk) => db().from("everything_claude_events").select("id, item_id, type").in("type", ["item_taken", "item_failed"]).in("item_id", chunk),
    queued.map((item) => item.id),
    "id",
    { label: "claude takes" },
  );
  const lastEventType = new Map<string, string>();
  for (const e of events.sort((a, b) => a.id - b.id)) lastEventType.set(e.item_id, e.type);
  const isTaken = (item: QueueItem) => lastEventType.get(item.id) === "item_taken";
  const ordered = queued.sort(inPipelineOrder);
  return { waiting: ordered.filter((item) => !isTaken(item)), taken: ordered.filter(isTaken) };
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

export type PostRunOutcome = "done" | "skipped" | "incomplete" | "failed";

/** Writes one everything_claude_runs row for a Claude run that ended, with
 *  what it would have cost on the API. usageShare.ts splits the plan's usage
 *  by these costs. `ref` names what the run was for. */
export async function recordClaudeRun(run: {
  tags: ClaudeRunTag[];
  startedAt: number;
  runDir: string;
  apiCostUsd: number | null;
  ref: { pipeline_run_id: string } | { everything_pipeline_run_id: string } | { draft_id: string } | null;
}) {
  check(
    await db()
      .from("everything_claude_runs")
      .insert({ tags: run.tags, started_at: new Date(run.startedAt).toISOString(), run_dir: run.runDir, api_cost_usd: run.apiCostUsd, ...run.ref }),
  );
}

/** The environment variable through which a post's Claude, and every command
 *  it runs, knows its run row. The draft command stores it on each draft. */
export const RUN_ID_ENV = "CN_RUN_ID";

/** Writes the everything_pipeline_runs row of one post's Claude run, with the
 *  post's A/B picks, the way the pipeline writes one per claim. So the same
 *  readouts can compare the arms. It is written when the Claude starts, so
 *  its drafts can point at it. The cost column stays empty, because the daily
 *  spend cap adds it up in dollars, and Claude spends plan usage, not money.
 *  What each attempt would have cost on the API is in everything_claude_runs. */
export async function startPostRun(itemId: string, picks: Record<string, string>): Promise<string> {
  const row = unwrap(
    await db()
      .from("everything_pipeline_runs")
      .insert({ kind: "claude", item_id: itemId, bot_name: CLAUDE_CODE_BOT, outcome: "running", ab_test_picks: picks })
      .select("id")
      .single(),
  );
  return row.id;
}

export async function endPostRun(runId: string, outcome: PostRunOutcome, logs: Record<string, unknown>) {
  check(await db().from("everything_pipeline_runs").update({ outcome, logs: logs as Json }).eq("id", runId));
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

/** Stores one reading of the plan's usage, for the admin dashboard's chart. */
export async function recordUsage(reading: { weekly: number; fiveHour: number; weeklyResetsAt: string; fiveHourResetsAt: string }) {
  check(
    await db().from("everything_claude_usage").insert({
      weekly: reading.weekly,
      five_hour: reading.fiveHour,
      weekly_resets_at: reading.weeklyResetsAt,
      five_hour_resets_at: reading.fiveHourResetsAt,
    }),
  );
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
// The note judge's answers (GOO-591)
// ---------------------------------------------------------------------------

/** The notes on the site whose current text the judge has not answered for,
 *  newest first. A rewritten note is judged again. */
export async function draftsToJudge(): Promise<string[]> {
  const [drafts, judgements] = await Promise.all([
    fetchAllRows<{ id: string; note: string; created_at: string }>(
      () => db().from("everything_claude_drafts").select("id, note, created_at").eq("outcome", "note").eq("status", "posted"),
      "id",
      { label: "drafts to judge" },
    ),
    fetchAllRows<{ draft_id: string; note: string }>(() => db().from("everything_claude_judgements").select("draft_id, note"), "draft_id", { label: "judgements" }),
  ]);
  const judgedText = new Map(judgements.map((j) => [j.draft_id, j.note]));
  return drafts
    .filter((d) => judgedText.get(d.id) !== d.note)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((d) => d.id);
}

/** The id of the newest entry of the log, where reading the posts after it
 *  starts. */
export async function latestEventId(): Promise<number> {
  const { data, error } = await db().from("everything_claude_events").select("id").order("id", { ascending: false }).limit(1);
  if (error) throw new Error(JSON.stringify(error));
  return data[0]?.id ?? 0;
}

/** The notes posted after a log entry, oldest first. A replaced note is
 *  posted anew, so its new text is among them. */
export async function postedAfter(eventId: number): Promise<{ id: number; draftId: string }[]> {
  const rows = await fetchAllRows<{ id: number; draft_id: string | null }>(
    () => db().from("everything_claude_events").select("id, draft_id").eq("type", "posted").gt("id", eventId),
    "id",
    { label: "posted events" },
  );
  return rows.flatMap((r) => (r.draft_id ? [{ id: r.id, draftId: r.draft_id }] : [])).sort((a, b) => a.id - b.id);
}

/** The seed of the examples' fixed shuffled order. In the order they were
 *  written, labels come in runs, and a run of one label right before the note
 *  to judge pulls the judge towards it. */
const JUDGE_EXAMPLE_ORDER_SEED = 563;

interface ExampleDraft {
  id: string;
  passage: string;
  context_paragraph: string | null;
  note: string;
  sources: DraftSource[];
  verdict: string | null;
  review_note: string | null;
  note_id: string | null;
  created_at: string;
  item: { url: string; title: string | null; project: { name: string } | null };
}

/** A note's label for the judge's examples: the notes of the review page's
 *  Approved and Disapproved sections. Jim's or Nathan's verdict decides, and
 *  without one the overall rating does. Any other note has no label. */
function exampleOutcome(draft: ExampleDraft, tally: NoteTallyFields | undefined): JudgeExample["outcome"] | null {
  if (draft.verdict === "approved") return "helpful";
  if (draft.verdict === "disapproved") return "not_helpful";
  const status = tally && noteStatus(tally);
  return status === "helpful" || status === "not_helpful" ? status : null;
}

/** The judge's examples: every approved and disapproved note, in a fixed
 *  shuffled order, each with the reviewers' note as its reason. */
export async function judgeExamples(): Promise<JudgeExample[]> {
  const drafts = await fetchAllRows<ExampleDraft>(
    () =>
      db()
        .from("everything_claude_drafts")
        .select("id, passage, context_paragraph, note, sources, verdict, review_note, note_id, created_at, item:everything_items(url, title, project:everything_projects(name))")
        .eq("outcome", "note")
        .in("status", ["posted", "removed"]),
    "id",
    { label: "judge example drafts" },
  );
  const tallies = await fetchInBatches<NoteTallyFields & { id: string }>(
    (chunk) => db().from("everything_notes").select("id, helpful_count, somewhat_helpful_count, not_helpful_count, author_id").in("id", chunk),
    drafts.flatMap((d) => (d.note_id ? [d.note_id] : [])),
    "id",
  );
  const tallyById = new Map(tallies.map((t) => [t.id, t]));
  const labelled = drafts
    .flatMap((d) => {
      const outcome = exampleOutcome(d, d.note_id ? tallyById.get(d.note_id) : undefined);
      return outcome ? [{ draft: d, outcome }] : [];
    })
    .sort((a, b) => (a.draft.created_at < b.draft.created_at ? 1 : -1))
    .map(({ draft: d, outcome }) => ({
      draftId: d.id,
      outcome,
      reason: d.review_note,
      post: { title: d.item.title, url: d.item.url, creator: d.item.project?.name ?? null },
      passage: d.passage,
      contextParagraph: d.context_paragraph,
      note: d.note,
      sources: d.sources,
    }));
  return shuffled(labelled, JUDGE_EXAMPLE_ORDER_SEED);
}

/** A draft as the judge reads it. */
export async function readJudgedNote(draftId: string): Promise<JudgedNote> {
  const d = unwrap(
    await db()
      .from("everything_claude_drafts")
      .select("passage, context_paragraph, note, sources, item:everything_items(url, title, project:everything_projects(name))")
      .eq("id", draftId)
      .single(),
  );
  const item = d.item as unknown as { url: string; title: string | null; project: { name: string } | null };
  return {
    post: { title: item.title, url: item.url, creator: item.project?.name ?? null },
    passage: d.passage,
    contextParagraph: d.context_paragraph,
    note: d.note,
    sources: d.sources as unknown as DraftSource[],
  };
}

/** Stores the judge's answer for the text it judged. */
export async function saveJudgement(draftId: string, note: string, judgement: Judgement) {
  check(
    await db()
      .from("everything_claude_judgements")
      .upsert({ draft_id: draftId, note, p_helpful: judgement.pHelpful, p_impactful: judgement.pImpactful, reasoning: judgement.reasoning, judged_at: new Date().toISOString() }),
  );
}
