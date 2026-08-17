import { supabase } from "./supabase";

/** Records that a reader asked for a Common Note on a page we do not cover yet. The
 *  request comes from "Request notes on this page" in the popup. It is written to
 *  everything_note_requests, which migration 066 added. Migration 067 made the
 *  selection column nullable, because a request now applies to a whole page. Nothing
 *  in the app reads this table. The team queries it in SQL. */
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
