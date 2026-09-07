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
 *  without the token the row is unreachable. Against a backend that predates
 *  the token column the request is still submitted, and null says live
 *  progress is unavailable. */
export async function submitNoteRequest(params: {
  pageUrl: string;
  pageTitle: string;
  selection: string | null;
  pageText?: string | null;
}): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const row = {
    page_url: params.pageUrl,
    page_title: params.pageTitle,
    selection: params.selection,
    page_text: params.pageText?.slice(0, MAX_PAGE_TEXT_LENGTH) || null,
    user_id: data.session?.user.id ?? null,
  };
  const token = crypto.randomUUID();
  const { error } = await supabase.from("everything_note_requests").insert({ ...row, client_token: token });
  if (!error) return token;
  // An old backend has no client_token column and rejects the whole insert.
  // The request matters more than the progress card, so we retry without it.
  if (!error.message.includes("client_token")) throw new Error(error.message);
  const { error: retryError } = await supabase.from("everything_note_requests").insert(row);
  if (retryError) throw new Error(retryError.message);
  return null;
}

/** Records that a reader wants a whole Substack publication or YouTube channel
 *  fact-checked for the next week. This writes straight into the creator's
 *  project row: the database decides the window, because the key this runs with
 *  is public. See migration 086. Anonymous presses are allowed.
 *
 *  Pressing a creator we already know updates their row instead of inserting,
 *  which the database's own trigger does. That path deliberately affects no
 *  rows, so an empty result is success and not failure. */
export async function requestCreatorPriority(params: { feedUrl: string }) {
  const { error } = await supabase.from("everything_projects").insert({ feed_url: params.feedUrl });
  if (error) throw new Error(error.message);
}
