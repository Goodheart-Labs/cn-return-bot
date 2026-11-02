/* Reads every note on the four posts from prod, with its rating state and who
 * wrote it, into out/ground-truth.json. Read-only. */

import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { db } from "../../claude-notes/store";
import { noteStatus } from "../../everything-core/noteScore";
import { POSTS } from "./posts";

const OUT = path.join(import.meta.dir, "out");

/** What each Claude Code run on the post cost, as Claude Code reports the
 *  price of the same run on the API. */
async function claudeRunsOn(itemId: string) {
  const { data: runs, error } = await db().from("everything_pipeline_runs").select("id, created_at").eq("item_id", itemId).eq("kind", "claude");
  if (error) throw new Error(JSON.stringify(error));
  if (!runs.length) return [];
  const { data: costs, error: costError } = await db()
    .from("everything_claude_runs")
    .select("everything_pipeline_run_id, api_cost_usd, started_at, ended_at, tags")
    .in("everything_pipeline_run_id", runs.map((r) => r.id));
  if (costError) throw new Error(JSON.stringify(costError));
  return costs;
}

async function textOf(url: string) {
  const { data, error } = await db().from("everything_items").select("full_text").eq("url", url).single();
  if (error) throw new Error(JSON.stringify(error));
  return data.full_text;
}

async function notesOf(url: string, textUrl: string) {
  const { data: item, error } = await db().from("everything_items").select("id, title, url, full_text").eq("url", url).maybeSingle();
  if (error) throw new Error(JSON.stringify(error));
  if (!item) return { url, missing: true };
  const { data: claims, error: claimError } = await db()
    .from("everything_claims")
    .select("id, claim, context_quote, created_by, everything_notes(id, note, author_id, author_name, status, helpful_count, somewhat_helpful_count, not_helpful_count, p_helpful, improved_from_note_id, created_at)")
    .eq("item_id", item.id);
  if (claimError) throw new Error(JSON.stringify(claimError));
  const { data: drafts, error: draftError } = await db().from("everything_claude_drafts").select("note_id").eq("item_id", item.id).not("note_id", "is", null);
  if (draftError) throw new Error(JSON.stringify(draftError));
  const claudeNoteIds = new Set(drafts.map((d) => d.note_id));
  const notes = claims.flatMap((claim) =>
    claim.everything_notes.map((note) => ({
      ...note,
      claim: claim.claim,
      passage: claim.context_quote,
      writer: claudeNoteIds.has(note.id) ? "claude" : note.author_id ? "human" : "pipeline",
      rating: noteStatus(note),
    })),
  );
  return { url, itemId: item.id, title: item.title, fullText: textUrl === url ? item.full_text : await textOf(textUrl), notes, claudeRuns: await claudeRunsOn(item.id) };
}

mkdirSync(OUT, { recursive: true });
const posts = [];
for (const post of POSTS) posts.push({ slug: post.slug, ...(await notesOf(post.url, "textUrl" in post ? post.textUrl : post.url)) });
writeFileSync(path.join(OUT, "ground-truth.json"), JSON.stringify(posts, null, 2));
for (const post of posts) {
  if ("missing" in post) {
    console.log(post.slug, "MISSING");
    continue;
  }
  const count = (pick: (n: (typeof post.notes)[number]) => boolean) => post.notes.filter(pick).length;
  console.log(post.slug, post.title, `chars=${post.fullText?.length}`, `claudeRuns=${JSON.stringify(post.claudeRuns.map((r) => r.api_cost_usd))}`, `notes=${post.notes.length}`, `helpful=${count((n) => n.rating === "helpful")}`,
    `byWriter=${JSON.stringify(Object.fromEntries(["claude", "human", "pipeline"].map((w) => [w, count((n) => n.writer === w)])))}`,
    `helpfulByWriter=${JSON.stringify(Object.fromEntries(["claude", "human", "pipeline"].map((w) => [w, count((n) => n.writer === w && n.rating === "helpful")])))}`,
    `statuses=${JSON.stringify([...new Set(post.notes.map((n) => n.status))])}`);
}
