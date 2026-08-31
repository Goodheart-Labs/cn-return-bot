import { supabase } from "../../everything-shared/supabase";
import type { PageItem } from "../../everything-shared/notesQuery";
import { extractYoutubeVideoId } from "../../everything-shared/pageUrls";
import { isSubstackPostPage } from "./followTarget";
import { getSettings, getWelcomeSeen, type VisitSiteKind } from "./settings";

// Visits are recorded on Substack, YouTube, and LessWrong, and only for
// content pages: a post or a video, never a homepage or a feed. Visit counts
// per link are what tells the team where notes are needed, so the page does
// NOT have to be covered already. An ingested page is recognized by its item's
// source, which also catches newsletters on custom domains and videos from the
// old podcast pipeline. A page we have not ingested is recognized by its URL:
// a watch URL on YouTube, a /p/ post path on Substack (content scripts only
// run on hosts we know, so a /p/ path there is a Substack post), a /posts/
// path on LessWrong.
const LESSWRONG_HOSTNAME = /(^|\.)lesswrong\.com$/;

function visitSiteKind(pageUrl: string, item: PageItem | null): VisitSiteKind | null {
  if (item?.source === "substack") return "substack";
  if (item?.source === "youtube" || item?.source === "podcast") return "youtube";
  try {
    const url = new URL(pageUrl);
    if (LESSWRONG_HOSTNAME.test(url.hostname)) return url.pathname.startsWith("/posts/") ? "lesswrong" : null;
  } catch {
    return null;
  }
  if (extractYoutubeVideoId(pageUrl)) return "youtube";
  if (isSubstackPostPage(pageUrl)) return "substack";
  return null;
}

/** Records that a post or video on one of the tracked sites was opened, so the
 *  team can see which links are read and where notes are needed most. `item`
 *  is the page's ingested row when it has one, and null for a page we have not
 *  checked; both count. The row stores the item's own URL when there is one,
 *  so every variant of the same page counts under one link. It is anonymous:
 *  no user id, just the URL, the item if any, and the time. A failed insert is
 *  dropped, because a visit count is not worth an error surface.
 *
 *  Recording is consentful twice over. Nothing is recorded until the welcome
 *  page has asked the user the visit-recording question, and nothing is
 *  recorded for a site kind the user turned off. */
export function recordPageVisit(pageUrl: string, item: PageItem | null): void {
  const kind = visitSiteKind(pageUrl, item);
  if (!kind) return;
  void (async () => {
    const [welcomed, settings] = await Promise.all([getWelcomeSeen(), getSettings()]);
    if (!welcomed || !settings.saveVisits[kind]) return;
    const { error } = await supabase
      .from("everything_link_visits")
      .insert({ url: item?.url ?? pageUrl, item_id: item?.id ?? null });
    if (error) console.debug(`[common-notes] visit not recorded: ${error.message}`);
  })();
}
