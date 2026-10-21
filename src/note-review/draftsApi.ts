/* The note review dashboard's server side (GOO-507). It runs inside the Vite
 * development server on the reviewer's machine and never ships to a browser.
 * It reads the Claude note writer's drafts and history from prod and records
 * the reviewer's approvals, rejections, rewrites and chat messages there, so
 * Jim's and Nathan's dashboards and the Claude session share one state. The
 * script that starts the server says who the reviewer is (CN_REVIEWER). */

import type { IncomingMessage, ServerResponse } from "http";
import type { Plugin } from "vite";
import { addMessage, approve, type DraftRow, eventsOfDrafts, type EventRow, listDrafts, readItemTexts, readSettings, reject, rewrite } from "../claude-notes/store";
import type { DraftSource, PostedAs, Reviewer, ReviewDraft, ReviewState } from "./src/draft";

/** A paragraph longer than this, such as a whole video transcript, is cut to a
 *  window of CONTEXT_WINDOW_CHARS around the passage. */
const MAX_PARAGRAPH_CHARS = 3_000;
const CONTEXT_WINDOW_CHARS = 1_500;
/** An agent's passage sometimes leaves out a footnote marker inside it, so a
 *  paragraph that holds only the passage's opening words counts too. */
const PASSAGE_OPENING_CHARS = 40;

function reviewer(): Reviewer {
  const value = process.env.CN_REVIEWER;
  if (value !== "jim" && value !== "nathan") throw new Error("Start the dashboard with CN_REVIEWER=jim or CN_REVIEWER=nathan");
  return value;
}

/** The paragraph of the post that contains the passage. */
function contextParagraph(postText: string | null, passage: string): string | undefined {
  if (!postText) return undefined;
  const paragraphs = postText.split(/\n\s*\n/);
  const opening = passage.slice(0, PASSAGE_OPENING_CHARS);
  const paragraph = paragraphs.find((p) => p.includes(passage)) ?? paragraphs.find((p) => p.includes(opening));
  if (!paragraph || paragraph.length <= MAX_PARAGRAPH_CHARS) return paragraph;
  const passageStart = Math.max(0, paragraph.indexOf(opening));
  const start = paragraph.lastIndexOf(" ", Math.max(0, passageStart - CONTEXT_WINDOW_CHARS / 2)) + 1;
  const end = paragraph.indexOf(" ", passageStart + passage.length + CONTEXT_WINDOW_CHARS / 2);
  return `${start > 0 ? "… " : ""}${paragraph.slice(start, end < 0 ? undefined : end)}${end < 0 ? "" : " …"}`;
}

/** Rewrites imported from the GOO-504 file log name the old text previousNote. */
const previousNote = (e: EventRow): string | undefined => {
  const data = e.data as Record<string, string>;
  return data.previous_note ?? data.previousNote;
};

type ItemText = { url: string; title: string | null; creator: string; fullText: string | null };

function toReviewDraft(row: DraftRow, events: EventRow[], item: ItemText): ReviewDraft {
  const data = (e: EventRow) => e.data as Record<string, string>;
  return {
    id: row.id,
    itemId: row.item_id,
    passage: row.passage,
    claim: row.claim,
    kind: row.kind as ReviewDraft["kind"],
    outcome: row.outcome as ReviewDraft["outcome"],
    note: row.note,
    reasoning: row.reasoning,
    sources: row.sources as unknown as DraftSource[],
    status: row.status as ReviewDraft["status"],
    noteId: row.note_id,
    postedAs: row.posted_as as PostedAs | null,
    reviewedBy: row.reviewed_by as Reviewer | null,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    post: { url: item.url, title: item.title ?? item.url, creator: item.creator },
    contextParagraph: contextParagraph(item.fullText, row.passage),
    messages: events
      .filter((e) => e.type === "message" || e.type === "answer")
      .map((e) => ({ at: e.at, actor: e.actor as Reviewer | "claude", text: data(e).text ?? "" })),
    earlierVersions: events
      .filter((e) => (e.type === "rewritten" && previousNote(e)) || e.type === "withdrawn")
      .map((e) => ({ at: e.at, note: previousNote(e) ?? data(e).note ?? "", reason: data(e).reason ?? data(e).reply ?? "" })),
  };
}

async function reviewState(): Promise<ReviewState> {
  const [settings, rows] = await Promise.all([readSettings(), listDrafts()]);
  const [events, items] = await Promise.all([eventsOfDrafts(rows.map((r) => r.id)), readItemTexts([...new Set(rows.map((r) => r.item_id))])]);
  const eventsByDraft = Map.groupBy(events, (e) => e.draft_id);
  return {
    reviewer: reviewer(),
    approvalRequired: settings.approvalRequired,
    writer: settings.writer,
    drafts: rows.map((r) => toReviewDraft(r, eventsByDraft.get(r.id) ?? [], items.get(r.item_id)!)),
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, string>> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function act(draftId: string, action: string, body: Record<string, string>) {
  const by = reviewer();
  if (action === "approve") return approve(draftId, by);
  if (action === "reject") return reject(draftId, by, body.reason ?? "");
  if (action === "rewrite") return rewrite(draftId, { actor: by, note: body.note ?? "", postedAs: body.postedAs as PostedAs, reason: `${by} rewrote it in the dashboard` });
  if (action === "message") return addMessage(draftId, by, body.text ?? "");
  throw new Error(`Unknown action ${action}`);
}

/** GET /api/drafts returns the review state. POST /api/drafts/<id>/approve,
 *  /reject { reason }, /rewrite { note, postedAs } and /message { text }
 *  record the reviewer's step. */
export const draftsApi: Plugin = {
  name: "note-review-drafts-api",
  configureServer(server) {
    server.middlewares.use("/api/drafts", (req, res) => {
      const [draftId, action] = new URL(req.url ?? "/", "http://localhost").pathname.split("/").filter(Boolean);
      const handle = async () => {
        if (req.method === "GET" && !draftId) return send(res, 200, await reviewState());
        if (req.method === "POST" && draftId && action) {
          await act(draftId, action, await readJson(req));
          return send(res, 200, {});
        }
        send(res, 404, { error: "Unknown request" });
      };
      handle().catch((err: unknown) => send(res, 500, { error: err instanceof Error ? err.message : JSON.stringify(err) }));
    });
  },
};
