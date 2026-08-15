import { supabase } from "./supabase";

/** The database caps everything_note_requests.page_text at this length
 *  (migration 076). Clients cut the captured text here so an oversized page
 *  cannot make the insert fail. */
export const MAX_PAGE_TEXT_LENGTH = 500_000;

/** Records that a reader asked for Common Notes on a page. The request lands in
 *  everything_note_requests, which the pipeline's request consumer turns into a
 *  queue entry at the highest priority tier. A request on a whole page carries
 *  no selection; a request on a highlighted paragraph carries it. `pageText` is
 *  the page's body text captured on the reader's device. It lets the pipeline
 *  fact-check pages it cannot fetch itself, so send it whenever the caller can
 *  read the page. Anonymous requests are allowed. */
export async function submitNoteRequest(params: {
  pageUrl: string;
  pageTitle: string;
  selection: string | null;
  pageText?: string | null;
}) {
  const { data } = await supabase.auth.getSession();
  const { error } = await supabase.from("everything_note_requests").insert({
    page_url: params.pageUrl,
    page_title: params.pageTitle,
    selection: params.selection,
    page_text: params.pageText?.slice(0, MAX_PAGE_TEXT_LENGTH) || null,
    user_id: data.session?.user.id ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Records that a reader asked us to keep a whole Substack publication or
 *  YouTube channel fact-checked. The request lands in everything_follow_requests
 *  and the pipeline's consumer validates the feed and starts following it.
 *  Anonymous requests are allowed. */
export async function submitFollowRequest(params: {
  feedType: "substack" | "youtube";
  feedUrl: string;
  title?: string;
}) {
  const { data } = await supabase.auth.getSession();
  const { error } = await supabase.from("everything_follow_requests").insert({
    feed_type: params.feedType,
    feed_url: params.feedUrl,
    title: params.title ?? "",
    user_id: data.session?.user.id ?? null,
  });
  if (error) throw new Error(error.message);
}
