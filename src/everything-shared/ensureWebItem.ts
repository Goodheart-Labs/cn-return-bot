import { supabase } from "./supabase";

const WEB_PROJECT_SLUG = "web";
const POSTGRES_UNIQUE_VIOLATION = "23505";

/** Find-or-create the everything_items row for an arbitrary web page — the
 *  write-anywhere flow's precursor (a note needs a claim, a claim needs an
 *  item). Client inserts are RLS-constrained to source='web' under the
 *  catch-all project (migration 068); `url` is unique, so a losing race
 *  simply re-selects the winner's row. Returns the item id. */
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
