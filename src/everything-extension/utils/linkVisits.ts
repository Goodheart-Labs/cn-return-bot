import { supabase } from "../../everything-shared/supabase";
import type { PageItem } from "../../everything-shared/notesQuery";

// Visits are recorded on Substack, YouTube, and LessWrong only. Substack and
// YouTube are recognized by the item's source, which also catches newsletters
// on custom domains and videos ingested through the old podcast pipeline.
// LessWrong items carry the catch-all "web" source, so they are recognized by
// their hostname instead.
const YOUTUBE_AND_SUBSTACK_SOURCES = ["substack", "youtube", "podcast"];
const LESSWRONG_HOSTNAME = /(^|\.)lesswrong\.com$/;

function isTrackedSite(item: PageItem): boolean {
  if (YOUTUBE_AND_SUBSTACK_SOURCES.includes(item.source)) return true;
  try {
    return LESSWRONG_HOSTNAME.test(new URL(item.url).hostname);
  } catch {
    return false;
  }
}

/** Records that a covered page was opened, so the team can see how often each
 *  link is visited. This runs only after the on-device coverage check has
 *  already said the page is one of ours; a page we do not cover never causes
 *  any request. The row stores the item's own URL rather than the address
 *  bar's, so every variant of the same page counts under one link. It is
 *  anonymous: no user id, just the URL, the item and the time. A failed
 *  insert is dropped, because a visit count is not worth an error surface. */
export function recordLinkVisit(item: PageItem): void {
  if (!isTrackedSite(item)) return;
  void supabase
    .from("everything_link_visits")
    .insert({ url: item.url, item_id: item.id })
    .then(({ error }) => {
      if (error) console.debug(`[common-notes] visit not recorded: ${error.message}`);
    });
}
