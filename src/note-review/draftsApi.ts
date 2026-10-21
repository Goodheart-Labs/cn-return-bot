/* The note review dashboard's server side (GOO-504). It runs inside the Vite
 * development server on the reviewer's machine and never ships to a browser.
 * The drafts are JSON files that the note-finding agents write. Accepting a
 * draft posts it to prod as Jim, with its sources and their supporting quotes.
 * Rejecting it records the reason. Both decisions are appended to
 * docs/note-examples.md, which the agents read before they write notes. */

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { createClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";
import type { Plugin } from "vite";
import { ENV_DIR } from "../cnEnv";
import type { Draft, DraftReview } from "./src/draft";

const DRAFTS_DIR = path.join(homedir(), ".local/share/claude-note-finder/drafts");
const EXAMPLES_PATH = path.join(ENV_DIR, "docs/note-examples.md");
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

const draftPath = (file: string) => {
  if (!/^[\w.-]+\.json$/.test(file)) throw new Error(`Not a draft file name: ${file}`);
  return path.join(DRAFTS_DIR, file);
};

function readDrafts(): Draft[] {
  if (!existsSync(DRAFTS_DIR)) return [];
  return readdirSync(DRAFTS_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({ ...JSON.parse(readFileSync(draftPath(file), "utf8")), file }));
}

function saveReview(file: string, review: DraftReview) {
  const { file: _file, ...draft } = readDrafts().find((d) => d.file === file)!;
  writeFileSync(draftPath(file), JSON.stringify({ ...draft, review }, null, 2));
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

function quoteBlock(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function appendDecision(draft: Draft, review: DraftReview) {
  const verdict = review.decision === "accepted" ? "Jim accepted" : "Jim rejected";
  const reason = review.reason ? `\nJim's reason: ${review.reason}\n` : "";
  appendFileSync(
    EXAMPLES_PATH,
    `\n### ${verdict} (${review.at.slice(0, 10)})\nPost: [${draft.postTitle}](${draft.postUrl})\n\nPassage:\n${quoteBlock(draft.passage)}\n\nNote:\n${quoteBlock(draft.note)}\n${draft.sources.map((s) => `\n${s.url}`).join("")}\n${reason}`,
  );
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

async function decide(file: string, decision: DraftReview["decision"], reason: string | undefined): Promise<DraftReview> {
  const draft = readDrafts().find((d) => d.file === file);
  if (!draft) throw new Error(`No draft ${file}`);
  if (draft.review) throw new Error(`Draft ${file} was already ${draft.review.decision}`);
  const noteId = decision === "accepted" ? await postAsJim(draft) : undefined;
  const review: DraftReview = { decision, at: new Date().toISOString(), ...(reason && { reason }), ...(noteId && { noteId }) };
  saveReview(file, review);
  appendDecision(draft, review);
  return review;
}

/** GET /api/drafts lists every draft. POST /api/drafts/<file>/accept and
 *  POST /api/drafts/<file>/reject with { reason } record a decision. */
export const draftsApi: Plugin = {
  name: "note-review-drafts-api",
  configureServer(server) {
    server.middlewares.use("/api/drafts", (req, res) => {
      const [file, action] = new URL(req.url ?? "/", "http://localhost").pathname.split("/").filter(Boolean);
      const handle = async () => {
        if (req.method === "GET" && !file) return send(res, 200, readDrafts());
        if (req.method === "POST" && file && (action === "accept" || action === "reject")) {
          const { reason } = await readJson(req);
          return send(res, 200, await decide(file, action === "accept" ? "accepted" : "rejected", reason?.trim() || undefined));
        }
        send(res, 404, { error: "Unknown request" });
      };
      handle().catch((err: unknown) => send(res, 500, { error: err instanceof Error ? err.message : JSON.stringify(err) }));
    });
  },
};
