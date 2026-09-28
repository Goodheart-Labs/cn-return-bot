import { supabase } from "./supabase";
import { WEB_PROJECT_SLUG } from "./projects";
const POSTGRES_UNIQUE_VIOLATION = "23505";

/** Finds or creates the everything_items row for any web page, and returns its id.
 *  The write-anywhere flow needs this first, because a note hangs off a claim and a
 *  claim hangs off an item. Row level security only lets a client insert rows with
 *  source='web' under the catch-all project, which migration 068 set up. The `url`
 *  column is unique, so when two clients race, the loser simply reads the winner's
 *  row. */
export async function ensureWebItem(params: { url: string; title: string }): Promise<string> {
  const url = params.url.replace(/\/$/, "");
  const existing = await supabase
    .from("everything_items")
    .select("id")
    .in("url", [url, `${url}/`])
    .limit(1);
  if (existing.data?.[0]) return existing.data[0].id;

  const { data: project } = await supabase
    .from("everything_projects")
    .select("id")
    .eq("slug", WEB_PROJECT_SLUG)
    .maybeSingle();
  if (!project) throw new Error("the 'web' project is missing — run migration 068");

  const inserted = await supabase
    .from("everything_items")
    .insert({
      project_id: project.id,
      source: "web",
      url,
      title: params.title || null,
      status: "done",
    })
    .select("id")
    .single();
  if (inserted.data) return inserted.data.id;
  if (inserted.error?.code === POSTGRES_UNIQUE_VIOLATION) {
    const winner = await supabase.from("everything_items").select("id").eq("url", url).maybeSingle();
    if (winner.data) return winner.data.id;
  }
  throw new Error(inserted.error?.message ?? "could not create the page item");
}
