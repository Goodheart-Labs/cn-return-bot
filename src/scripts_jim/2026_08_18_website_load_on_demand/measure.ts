/** Measures what the Common Notes website reads from Supabase on a cold page
 *  load, before and after the on-demand loading change. It runs both query sets
 *  against the production backend with the anon key the site ships with, and
 *  reports the bytes and the request count of each. */
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  (await Bun.file(".env.prod-backend").text())
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

let bytes = 0;
let requests = 0;
const countingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input as any, init);
  const body = await res.text();
  requests += 1;
  bytes += body.length;
  return new Response(body, { status: res.status, headers: res.headers });
};

const supabase = createClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!, {
  global: { fetch: countingFetch },
});

const CLAIM_COLS =
  "id, item_id, claim, context_quote, context_paragraph, updated_quote, context_url, start_seconds, end_seconds, image_urls";

function reset() {
  bytes = 0;
  requests = 0;
}
function report(label: string) {
  console.log(`${label.padEnd(46)} ${String(requests).padStart(2)} requests  ${(bytes / 1024).toFixed(1).padStart(8)} KB`);
  reset();
}

// The schema probe runs in both versions, so it is measured once and left out of
// the comparison.
async function probe() {
  await Promise.all([
    supabase.from("everything_claims").select("image_urls").limit(1),
    supabase.from("everything_note_sources").select("url").limit(1),
    supabase.from("everything_note_not_needed").select("id").limit(1),
  ]);
  report("schema probe (unchanged, both versions)");
}

async function before() {
  await Promise.all([
    supabase.from("everything_projects").select("*").order("sort_order"),
    supabase.from("everything_items").select("*"),
    supabase
      .from("everything_notes")
      .select(
        `*, claim:everything_claims(${CLAIM_COLS}), sources:everything_note_sources(url, quote, explanation, sort_order)`,
      ),
    supabase.from("everything_note_not_needed").select("*"),
  ]);
  report("BEFORE: whole database, every project");
}

async function after(projectSlug: string | null) {
  const { data: projects } = await supabase
    .from("everything_projects")
    .select("id, slug, name, sort_order")
    .order("sort_order");
  let projectId = (projects ?? []).find((p: any) => p.slug === projectSlug)?.id;
  if (!projectId) {
    // No project in the URL, so the page asks which projects have content.
    const { data: withItems } = await supabase.from("everything_items").select("project_id");
    const ids = new Set((withItems ?? []).map((r: any) => r.project_id));
    projectId = (projects ?? []).find((p: any) => ids.has(p.id))?.id;
  }
  const noteSelect =
    `*, claim:everything_claims!inner(${CLAIM_COLS}, item:everything_items!inner(project_id)), ` +
    "sources:everything_note_sources(url, sort_order), detailed:everything_note_sources(sort_order)";
  const [, notes] = await Promise.all([
    supabase.from("everything_items").select("id, project_id, url, title, published_at, created_at").eq("project_id", projectId),
    supabase
      .from("everything_notes")
      .select(noteSelect)
      .not("detailed.quote", "is", null)
      .eq("claim.item.project_id", projectId)
      .neq("status", "hidden"),
    supabase
      .from("everything_note_not_needed")
      .select("*, claim:everything_claims!inner(item:everything_items!inner(project_id))")
      .eq("claim.item.project_id", projectId)
      .order("created_at"),
  ]);
  const label = projectSlug ? `AFTER: ?project=${projectSlug}` : "AFTER: no project in the URL (default project)";
  const rows = (notes.data ?? []) as any[];
  report(`${label} [${rows.length} notes]`);
  return rows;
}

await probe();
await before();
await after(null);
await after("dwarkesh");
await after("arctotherium");

// Opening one note's source details is the only thing that reads a quote now.
const rows = await after("zvi");
const withDetails = rows.find((r) => (r.detailed ?? []).length > 0);
await supabase
  .from("everything_note_sources")
  .select("url, quote, explanation, sort_order")
  .eq("note_id", withDetails.id)
  .not("quote", "is", null)
  .order("sort_order");
report("AFTER: one note's source details, on open");
