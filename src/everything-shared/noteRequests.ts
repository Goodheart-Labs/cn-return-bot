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

/** Records that a reader wants a whole Substack publication or YouTube channel
 *  fact-checked for the next week. This writes straight into the creator's
 *  project row: the database decides the window, because the key this runs with
 *  is public. See migration 086. Anonymous presses are allowed.
 *
 *  Pressing a creator we already know updates their row instead of inserting,
 *  which the database's own trigger does. That path deliberately affects no
 *  rows, so an empty result is success and not failure. */
export async function requestCreatorPriority(params: { feedUrl: string }) {
  const { error } = await supabase
    .from("everything_projects")
    .insert({ feed_url: params.feedUrl }, { count: undefined });
  if (error) throw new Error(error.message);
}
