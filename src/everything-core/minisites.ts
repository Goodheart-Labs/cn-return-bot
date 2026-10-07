import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Tables } from "./database.types";
import { PAGE_ITEM_SELECT, type PageItem } from "./items";
import { supabase } from "./supabase";

export type Minisite = Tables<"everything_minisites">;
export type MinisiteJob = Tables<"everything_minisite_jobs">;

/** One row of the Minisites list. It leaves out the article text, which can be
 *  hundreds of kilobytes. */
export type MinisiteSummary = Omit<Minisite, "content" | "features" | "created_by" | "updated_at"> & {
  url: string;
  noteCount: number;
};

/** What the intake service writes into a finished read_page job. */
export interface PageReadResult {
  title: string;
  description: string;
  byline: string | null;
  published_at: string | null;
  image_url: string | null;
  content: string;
  plain_text: string;
  creator_feed_url: string | null;
}

const SUMMARY_COLUMNS = "id, slug, item_id, title, description, byline, published_at, image_url, created_at, item:everything_items!inner(url)";

async function countVisibleNotes(itemId: string): Promise<number> {
  const { count, error } = await supabase
    .from("everything_notes")
    .select("id, claim:everything_claims!inner(item_id)", { count: "exact", head: true })
    .eq("claim.item_id", itemId)
    .neq("status", "hidden");
  if (error) throw new Error(`note count failed: ${error.message}`);
  return count ?? 0;
}

/** Every minisite, newest first. There are few, so one note count each is fine. */
export async function fetchMinisites(): Promise<MinisiteSummary[]> {
  const { data, error } = await supabase.from("everything_minisites").select(SUMMARY_COLUMNS).order("created_at", { ascending: false });
  if (error) throw new Error(`minisite list failed: ${error.message}`);
  return Promise.all(data.map(async ({ item, ...row }) => ({ ...row, url: item.url, noteCount: await countVisibleNotes(row.item_id) })));
}

/** One minisite with its article, or null when no minisite has this slug. */
export async function fetchMinisite(slug: string): Promise<{ minisite: Minisite; item: PageItem } | null> {
  const { data, error } = await supabase.from("everything_minisites").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`minisite lookup failed: ${error.message}`);
  if (!data) return null;
  const { data: item, error: itemError } = await supabase.from("everything_items").select(PAGE_ITEM_SELECT).eq("id", data.item_id).single();
  if (itemError) throw new Error(`minisite article lookup failed: ${itemError.message}`);
  const { project, ...rest } = item;
  return { minisite: data, item: { ...(rest as Omit<PageItem, "projectSlug">), projectSlug: project?.slug ?? null } };
}

/** Whether the signed-in reader is an admin (migration 117). */
export async function fetchIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("everything_is_admin");
  if (error) throw new Error(`admin check failed: ${error.message}`);
  return data;
}

/** Asks the intake service to read a page. Returns the job's id. */
export async function requestPageRead(url: string): Promise<string> {
  const { data, error } = await supabase.from("everything_minisite_jobs").insert({ kind: "read_page", url }).select("id").single();
  if (error) throw new Error(`could not ask for the page: ${error.message}`);
  return data.id;
}

export async function fetchMinisiteJob(jobId: string): Promise<MinisiteJob> {
  const { data, error } = await supabase.from("everything_minisite_jobs").select("*").eq("id", jobId).single();
  if (error) throw new Error(`job lookup failed: ${error.message}`);
  return data;
}

/** Calls `onChange` whenever the job's row changes. Returns the unsubscribe. */
export function subscribeToMinisiteJob(jobId: string, onChange: () => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`minisite-job-${jobId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "everything_minisite_jobs", filter: `id=eq.${jobId}` }, onChange)
    .subscribe();
  return () => void supabase.removeChannel(channel);
}

export async function createMinisite(params: { jobId: string; slug: string; title: string; description: string; features: readonly string[] }): Promise<string> {
  const { data, error } = await supabase.rpc("everything_create_minisite", {
    job_id: params.jobId,
    new_slug: params.slug,
    new_title: params.title,
    new_description: params.description,
    new_features: [...params.features],
  });
  if (error) throw new Error(error.code === "23505" ? "That address is taken. Choose another." : error.message);
  return data;
}

/** What an admin may change on a minisite. The address and the article stay fixed. */
export type MinisiteSettings = Pick<Minisite, "title" | "description" | "image_url" | "features">;

export async function updateMinisite(minisiteId: string, settings: MinisiteSettings): Promise<void> {
  const { data, error } = await supabase
    .from("everything_minisites")
    .update({ ...settings, updated_at: new Date().toISOString() })
    .eq("id", minisiteId)
    .select("id");
  if (error) throw new Error(`The changes could not be saved: ${error.message}`);
  // Row level security answers a refused update with no rows instead of an error.
  if (!data.length) throw new Error("The changes could not be saved. Only admins can edit minisites.");
}

/** Deletes the minisite. Its article, notes and highlights stay on Common Notes. */
export async function deleteMinisite(minisiteId: string): Promise<void> {
  const { data, error } = await supabase.from("everything_minisites").delete().eq("id", minisiteId).select("id");
  if (error) throw new Error(`The minisite could not be deleted: ${error.message}`);
  if (!data.length) throw new Error("The minisite could not be deleted. Only admins can delete minisites.");
}

/** Queues the minisite's article for the full fact-check (migration 117). */
export async function startMinisiteCheck(minisiteId: string): Promise<void> {
  const { error } = await supabase.rpc("everything_start_minisite_check", { target_minisite: minisiteId });
  if (error) throw new Error(error.message);
}

/** The longest address name the database accepts (migration 117). */
const MAX_SLUG_LENGTH = 80;

/** A suggested address name for a title: lowercase words joined by dashes. */
export function slugForTitle(title: string): string {
  const words = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > MAX_SLUG_LENGTH) break;
    slug = next;
  }
  return slug === "new" ? "new-minisite" : slug;
}

export const VALID_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
