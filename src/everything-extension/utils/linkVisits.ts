import { browser } from "#imports";
import { supabase } from "../../everything-shared/supabase";
import type { PageItem } from "../../everything-shared/notesQuery";
import { extractYoutubeVideoId } from "../../everything-shared/pageUrls";
import { readWatchPageChannel } from "./authorFeed";
import { isSubstackPostPage } from "./pageShape";
import {
  forumPostAuthorTarget,
  isForumPostPage,
  readSubstackPublicationFromPage,
  substackCreatorTarget,
  substackTargetFromPublication,
  youtubeChannelTarget,
} from "./creatorTarget";
import { getSettings, getWelcomeSeen, type VisitSiteKind } from "./settings";
import { visitReaderHash } from "./visitReader";

// Visits are recorded on Substack, YouTube, and the LessWrong / Alignment
// Forum pair, and only for content pages: a post or a video, never a homepage
// or a feed. Visit counts per link are what tells the team where notes are
// needed, so the page does NOT have to be covered already. An ingested page is
// recognized by its item's source, which also catches newsletters on custom
// domains and videos from the old podcast pipeline. A page we have not
// ingested is recognized by its URL: a watch URL on YouTube, a /p/ post path
// on Substack (content scripts only run on hosts we know, so a /p/ path there
// is a Substack post), a /posts/ path on a forum host.
function visitSiteKind(pageUrl: string, item: PageItem | null): VisitSiteKind | null {
  if (item?.source === "substack") return "substack";
  if (item?.source === "youtube" || item?.source === "podcast") return "youtube";
  if (item?.source === "lesswrong") return "lesswrong";
  if (isForumPostPage(pageUrl)) return "lesswrong";
  if (extractYoutubeVideoId(pageUrl)) return "youtube";
  if (isSubstackPostPage(pageUrl)) return "substack";
  return null;
}

/** A YouTube watch page renders its owner box late on cold loads, so the
 *  channel read polls for a while before giving up. */
const WATCH_CHANNEL_POLL_MS = 500;
const WATCH_CHANNEL_POLL_TRIES = 20;

/** The creator's feed URL for the visited page: the Substack publication from
 *  the hostname or the page's preloads blob, the YouTube channel from the
 *  watch page's owner box, the forum author from the site's own API. Null when
 *  the page has no followable creator. The pipeline ranks creators by these
 *  (creatorRanking.ts), which is why the visit records the creator at all: a
 *  creator is not derivable on the server from a watch URL or a custom-domain
 *  post URL. */
async function pageFeedUrl(kind: VisitSiteKind, pageUrl: string): Promise<string | null> {
  if (kind === "substack") {
    const target = substackCreatorTarget(pageUrl) ?? substackTargetFromPublication(readSubstackPublicationFromPage());
    return target?.feedUrl ?? null;
  }
  if (kind === "lesswrong") return (await forumPostAuthorTarget(pageUrl))?.feedUrl ?? null;
  if (kind !== "youtube") return null;
  for (let attempt = 0; attempt < WATCH_CHANNEL_POLL_TRIES; attempt++) {
    const channel = readWatchPageChannel();
    if (channel) return youtubeChannelTarget(channel.href, channel.name)?.feedUrl ?? null;
    await new Promise((resolve) => setTimeout(resolve, WATCH_CHANNEL_POLL_MS));
  }
  return null;
}

/** What a content script sends the background once it has decided a page
 *  counts. The reader hash is added there, because the secret behind it is
 *  minted in one place only. */
export const VISIT_MESSAGE_TYPE = "cn-visit";

export interface VisitMessage {
  type: typeof VISIT_MESSAGE_TYPE;
  url: string;
  itemId: string | null;
  feedUrl: string | null;
}

/** Records that a post or video on one of the tracked sites was opened, so the
 *  team can see which links are read and where notes are needed most. `item`
 *  is the page's ingested row when it has one, and null for a page we have not
 *  checked; both count. The row stores the item's own URL when there is one,
 *  so every variant of the same page counts under one link, plus the creator's
 *  feed URL read out of the page.
 *
 *  The row names no account and no person. It carries a reader hash, which is
 *  one value per browser and per creator, so we can count how many people read
 *  a creator without the rows ever adding up to one person's reading across
 *  creators. See everything-shared/readers.ts.
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
    const message: VisitMessage = {
      type: VISIT_MESSAGE_TYPE,
      url: item?.url ?? pageUrl,
      itemId: item?.id ?? null,
      feedUrl: await pageFeedUrl(kind, pageUrl),
    };
    // The catch swallows the "receiving end does not exist" error, which a
    // content script left behind by an extension reload would otherwise throw.
    void browser.runtime.sendMessage(message).catch(() => {});
  })();
}

/** Writes the visit. This runs in the background, for the same two reasons the
 *  analytics events do: the reader secret has exactly one writer here, and a
 *  request sent from a content script is subject to the host page's own content
 *  policy. A failed insert is dropped, because a visit count is not worth an
 *  error surface. */
export async function writeVisit(visit: VisitMessage): Promise<void> {
  const { error } = await supabase.from("everything_link_visits").insert({
    url: visit.url,
    item_id: visit.itemId,
    feed_url: visit.feedUrl,
    reader_hash: visit.feedUrl ? await visitReaderHash(visit.feedUrl) : null,
  });
  if (error) console.debug(`[common-notes] visit not recorded: ${error.message}`);
}
