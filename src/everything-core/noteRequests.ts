import { supabase } from "./supabase";

/** The database caps everything_note_requests.page_text at this length
 *  (migration 077). Clients cut the captured text here so an oversized page
 *  cannot make the insert fail. */
export const MAX_PAGE_TEXT_LENGTH = 500_000;

/** Records that a reader asked for Common Notes on a page. The request lands in
 *  everything_note_requests, which the pipeline's request consumer turns into a
 *  queue entry at the highest priority tier. A request on a whole page carries
 *  no selection; a request on a highlighted paragraph carries it. `pageText` is
 *  the page's body text captured on the reader's device. It lets the pipeline
 *  fact-check pages it cannot fetch itself, so send it whenever the caller can
 *  read the page. Anonymous requests are allowed.
 *
 *  Returns the request's client token (migration 087), the device's only
 *  handle on its own request: exchanging it via everything_request_status is
 *  how the extension shows live progress. The table has no select policy, so
 *  without the token the row is unreachable. */
export async function submitNoteRequest(params: {
  pageUrl: string;
  pageTitle: string;
  selection: string | null;
  pageText?: string | null;
}): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = crypto.randomUUID();
  const { error } = await supabase.from("everything_note_requests").insert({
    page_url: params.pageUrl,
    page_title: params.pageTitle,
    selection: params.selection,
    page_text: params.pageText?.slice(0, MAX_PAGE_TEXT_LENGTH) || null,
    user_id: data.session?.user.id ?? null,
    client_token: token,
  });
  if (error) throw new Error(error.message);
  return token;
}
