/* The note review dashboard's server side (GOO-504). It runs inside the Vite
 * development server on the reviewer's machine and never ships to a browser.
 * The drafts are JSON files that the note-finding agents write. Accepting a
 * draft posts it to prod as Jim, with its sources and their supporting quotes.
 * Rejecting it records the reason. A chat message asks Claude a question or
 * for a change, on any draft; Claude answers with reviseDraft.ts. Every step goes into the review log, and
 * decisions are appended to docs/note-examples.md, which the agents read
 * before they write notes. */

import * as path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { createClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";
import type { Plugin } from "vite";
import { ENV_DIR } from "../cnEnv";
import { appendExample, contextParagraph, logReviewEvent, readDraft, readDrafts, writeDraft } from "./draftStore";
import type { Draft, DraftReview } from "./src/draft";

const JIM_USER_ID = "0e97e940-652f-466b-8693-c142257e083d";
const JIM_AUTHOR_NAME = "JimMaar1";
/** A claim a person created keeps only a preview of its text in `claim`, as on
 *  the website (postNote.ts). */
const CLAIM_PREVIEW_CHARS = 300;

function prodClient() {
  loadDotenv({ path: path.join(ENV_DIR, ".env"), quiet: true });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in the root .env");
  return createClient(url, key);
}

async function postAsJim(draft: Draft): Promise<string> {
  const db = prodClient();
  const { data: claim, error: claimError } = await db
    .from("everything_claims")
    .insert({
      item_id: draft.itemId,
      claim: draft.passage.slice(0, CLAIM_PREVIEW_CHARS),
      judgement: "user",
      context_quote: draft.passage,
      context_url: draft.postUrl,
      status: "note",
      created_by: JIM_USER_ID,
    })
    .select("id")
    .single();
  if (claimError) throw claimError;
  const { data: note, error: noteError } = await db
    .from("everything_notes")
    .insert({ claim_id: claim.id, note: draft.note, author_id: JIM_USER_ID, author_name: JIM_AUTHOR_NAME, status: "draft" })
    .select("id")
    .single();
  if (noteError) throw noteError;
  const sources = draft.sources.map((s, i) => ({ note_id: note.id, url: s.url, quote: s.quote, explanation: s.explanation, sort_order: i }));
  const { error: sourceError } = await db.from("everything_note_sources").insert(sources);
  if (sourceError) throw sourceError;
  return note.id;
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

function undecidedDraft(file: string): Draft {
  const draft = readDraft(file);
  if (draft.review) throw new Error(`Draft ${file} was already ${draft.review.decision}`);
  return draft;
}

async function decide(file: string, decision: DraftReview["decision"], reason: string | undefined): Promise<DraftReview> {
  const draft = undecidedDraft(file);
  const noteId = decision === "accepted" ? await postAsJim(draft) : undefined;
  const review: DraftReview = { decision, at: new Date().toISOString(), ...(reason && { reason }), ...(noteId && { noteId }) };
  writeDraft({ ...draft, review });
  logReviewEvent(
    noteId ? { type: "accepted", at: review.at, file, note: draft.note, noteId } : { type: "rejected", at: review.at, file, note: draft.note, reason },
  );
  appendExample({
    heading: `Jim ${decision} (${review.at.slice(0, 10)})`,
    draft,
    parts: [["Note", `${draft.note}\n\n${draft.sources.map((s) => s.url).join("\n")}`]],
    why: reason,
  });
  return review;
}

function comment(file: string, text: string) {
  const draft = readDraft(file);
  const at = new Date().toISOString();
  writeDraft({ ...draft, feedback: [...(draft.feedback ?? []), { at, comment: text, noteAtTheTime: draft.note }] });
  logReviewEvent({ type: "feedback", at, file, note: draft.note, comment: text });
}

/** GET /api/drafts lists every draft. POST /api/drafts/<file>/accept,
 *  /reject with { reason } and /comment with { comment } record a step. */
export const draftsApi: Plugin = {
  name: "note-review-drafts-api",
  configureServer(server) {
    server.middlewares.use("/api/drafts", (req, res) => {
      const [file, action] = new URL(req.url ?? "/", "http://localhost").pathname.split("/").filter(Boolean);
      const handle = async () => {
        if (req.method === "GET" && !file) return send(res, 200, readDrafts().map((d) => ({ ...d, contextParagraph: contextParagraph(d) })));
        if (req.method !== "POST" || !file) return send(res, 404, { error: "Unknown request" });
        const body = await readJson(req);
        if (action === "accept") return send(res, 200, await decide(file, "accepted", undefined));
        if (action === "reject") return send(res, 200, await decide(file, "rejected", body.reason?.trim() || undefined));
        if (action === "comment" && body.comment?.trim()) {
          comment(file, body.comment.trim());
          return send(res, 200, {});
        }
        send(res, 404, { error: "Unknown request" });
      };
      handle().catch((err: unknown) => send(res, 500, { error: err instanceof Error ? err.message : JSON.stringify(err) }));
    });
  },
};
