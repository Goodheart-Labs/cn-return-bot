import { supabase } from "./supabase";

/** Records that a reader opened a post or video (migration 076). The row
 *  carries no account, only the reader hash described in migration 089.
 *  Clients may only insert into this table. A failed insert is logged and
 *  dropped, because a lost visit costs one count and nothing else. */
export async function insertVisit(row: { url: string; itemId: string | null; feedUrl: string | null; readerHash: string | null }) {
  const { error } = await supabase.from("everything_link_visits").insert({
    url: row.url,
    item_id: row.itemId,
    feed_url: row.feedUrl,
    reader_hash: row.readerHash,
  });
  if (error) console.debug(`[common-notes] visit not recorded: ${error.message}`);
}
