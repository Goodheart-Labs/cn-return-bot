// Copies the posts of Nathan's Claude Code notes from prod into the local
// Supabase, so the current pipeline can run on them again without touching
// prod (GOO-495).
//
// `items` copies each post with its stored text and its project, queued and
// without any claims, so the local worker extracts and checks it from scratch.
// `nathan` copies Nathan's notes with their claims and sources. Run it after
// the rerun has finished, because the worker treats a queued item that already
// has claims as a resumed item and skips the extraction.
//
// Usage: bun run src/scripts_jim/2026_10_21_nathan_claude_code_notes/seedLocal.ts items|nathan

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { QUEUE_PRIORITY } from "../../everything/db";

const NATHAN_USER_ID = "963d0c31-33e5-47da-8aa1-386bc3289efb";
/** Nathan posted his Claude Code batch on 2026-10-21 between 00:19 and 01:00
 *  UTC. His earlier notes are hand-written. */
const CLAUDE_CODE_BATCH_START = "2026-10-21T00:00:00Z";
const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";

const prod = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const local = createClient(LOCAL_SUPABASE_URL, process.env.LOCAL_SUPABASE_SERVICE_KEY!);

async function unwrap<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(JSON.stringify(error));
  return data as T;
}

async function fetchNathanNotes() {
  return unwrap(
    prod
      .from("everything_notes")
      .select("*, claim:everything_claims(*), sources:everything_note_sources(*)")
      .eq("author_id", NATHAN_USER_ID)
      .gte("created_at", CLAUDE_CODE_BATCH_START),
  );
}

async function seedItems() {
  const notes = await fetchNathanNotes();
  const itemIds = [...new Set(notes.map((note) => note.claim.item_id as string))];
  const items = await unwrap(prod.from("everything_items").select("*").in("id", itemIds));
  const projectIds = [...new Set(items.map((item) => item.project_id as string))];
  const projects = await unwrap(prod.from("everything_projects").select("*").in("id", projectIds));

  // The migrations create the project "web" with an id of their own, which
  // would collide with prod's row of the same slug.
  await unwrap(local.from("everything_projects").delete().in("slug", projects.map((project) => project.slug)).not("id", "in", `(${projectIds.join(",")})`));
  await unwrap(local.from("everything_projects").upsert(projects));
  const queuedItems = items.map((item) => ({
    ...item,
    status: "queued",
    priority: QUEUE_PRIORITY.prioritized,
    checked_scope: null,
    processed_at: null,
    started_at: null,
    error: null,
    skip_reason: null,
    progress: null,
    retries: 0,
  }));
  await unwrap(local.from("everything_items").upsert(queuedItems));
  console.log(`Copied ${projects.length} projects and ${items.length} queued items`);
}

async function seedNathanNotes() {
  const notes = await fetchNathanNotes();
  const { data: user, error } = await prod.auth.admin.getUserById(NATHAN_USER_ID);
  if (error) throw error;
  const existing = await local.auth.admin.getUserById(NATHAN_USER_ID);
  if (!existing.data.user) {
    const created = await local.auth.admin.createUser({
      id: NATHAN_USER_ID,
      email: user.user.email,
      email_confirm: true,
      user_metadata: user.user.user_metadata,
    } as Parameters<typeof local.auth.admin.createUser>[0] & { id: string });
    if (created.error) throw created.error;
  }

  const claims = notes.map((note) => note.claim);
  const sources = notes.flatMap((note) => note.sources);
  const noteRows = notes.map(({ claim: _claim, sources: _sources, ...note }) => note);
  await unwrap(local.from("everything_claims").upsert(claims));
  await unwrap(local.from("everything_notes").upsert(noteRows));
  if (sources.length) await unwrap(local.from("everything_note_sources").upsert(sources));
  console.log(`Copied ${noteRows.length} notes by Nathan, with ${sources.length} sources`);
}

const mode = process.argv[2];
if (mode === "items") await seedItems();
else if (mode === "nathan") await seedNathanNotes();
else throw new Error("Pass items or nathan");
