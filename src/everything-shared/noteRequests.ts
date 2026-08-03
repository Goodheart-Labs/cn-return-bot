import { supabase } from "./supabase";

/** Log that a reader asked for a Common Note on a page we don't cover yet
 *  ("Request notes on this page" in the popup). Write-only inbox
 *  (everything_note_requests, migration 066; selection nullable since 067 —
 *  requests are page-level now). The team reads it in SQL. */
export async function submitNoteRequest(params: { pageUrl: string; pageTitle: string; selection: string | null }) {
  const { data } = await supabase.auth.getSession();
  const { error } = await supabase.from("everything_note_requests").insert({
    page_url: params.pageUrl,
    page_title: params.pageTitle,
    selection: params.selection,
    user_id: data.session?.user.id ?? null,
  });
  if (error) throw new Error(error.message);
}
