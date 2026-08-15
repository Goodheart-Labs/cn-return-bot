import type { ContentScriptContext } from "#imports";
import { extractYoutubeVideoId, normalizePageUrl } from "../../everything-shared/notesQuery";
import { GROUP_GLYPH_PATH } from "../components/ClaimNoteStack";
import { getNotedPageCounts, trimSlash } from "./coveredPages";
import { isPageDark } from "./pageTheme";

// The badges that mark noted posts in a listing, for example on a Substack
// publication's front page or a YouTube channel's videos tab. Every link that
// leads to a page with notes gets a small pill with the community glyph and
// the number of notes there. The counts come from the locally synced cache,
// so drawing badges costs no backend request.

const RESCAN_DEBOUNCE_MS = 600;
const BADGE_CLASS = "cn-coverage-badge";

// The title links of the two listing surfaces we care most about. They are
// tried first, so the badge lands on the title. On any other site, or when
// these selectors find nothing, any link with a bit of visible text is
// eligible. The length floor keeps badges off icon links and bare comment
// counts.
const TITLE_LINK_SELECTOR = 'a[data-testid="post-preview-title"], a#video-title-link, a#video-title';
const FALLBACK_MIN_TEXT_LENGTH = 8;

/** The lookup key of a page URL: the video ID on YouTube, the normalized URL
 *  everywhere else. Returns null for links that cannot lead to a noted page,
 *  such as javascript: and mailto: links. */
function pageKey(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  return extractYoutubeVideoId(url.toString()) ?? trimSlash(normalizePageUrl(url.toString()));
}

function createBadge(count: number): HTMLElement {
  const dark = isPageDark();
  const badge = document.createElement("span");
  badge.className = BADGE_CLASS;
  badge.title = `${count} Common ${count === 1 ? "Note" : "Notes"} on this page`;
  badge.setAttribute(
    "style",
    "display:inline-flex;align-items:center;gap:3px;vertical-align:baseline;margin-left:6px;padding:1px 7px;" +
      "border-radius:9999px;font-size:12px;line-height:16px;font-weight:600;white-space:nowrap;" +
      `color:${dark ? "#60a5fa" : "#2563eb"};background:${dark ? "rgba(96,165,250,0.16)" : "rgba(37,99,235,0.10)"};`,
  );
  const svg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true" style="flex:none"><path d="${GROUP_GLYPH_PATH}"/></svg>`;
  badge.innerHTML = `${svg}${count}`;
  return badge;
}

/** Marks every listing link that leads to a noted page with a note-count
 *  badge. Badges are appended inside the link itself, so they sit right after
 *  the title and navigate with it. The scan re-runs debounced on DOM changes,
 *  which covers infinite scroll and single-page-app navigations, and each
 *  noted page gets one badge at a time: a badge the host page threw away in a
 *  re-render is simply placed again on the next scan. Returns a teardown
 *  function, or null when the counts have never been synced. */
export async function mountCoverageBadges(ctx: ContentScriptContext): Promise<(() => void) | null> {
  const counts = await getNotedPageCounts();
  if (!counts) return null;
  const countByKey = new Map<string, number>();
  for (const [url, count] of Object.entries(counts)) {
    const key = pageKey(url);
    if (key) countByKey.set(key, (countByKey.get(key) ?? 0) + count);
  }
  if (countByKey.size === 0) return null;

  // The one badge each noted page currently has, so a page linked several
  // times in one listing card is not badged on every link.
  const badges = new Map<string, HTMLElement>();

  const placeBadge = (anchor: HTMLAnchorElement, currentPageKey: string | null) => {
    const key = pageKey(anchor.href);
    if (!key || key === currentPageKey) return;
    const count = countByKey.get(key);
    if (!count) return;
    if (badges.get(key)?.isConnected) return;
    const badge = createBadge(count);
    anchor.appendChild(badge);
    badges.set(key, badge);
  };

  const scan = () => {
    // Links to the page we are already on carry no information, so they get
    // no badge. On a watch page that also spares every "same video at a
    // timestamp" link in the description.
    const currentPageKey = pageKey(location.href);
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>(TITLE_LINK_SELECTOR)) {
      placeBadge(anchor, currentPageKey);
    }
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if ((anchor.textContent ?? "").trim().length >= FALLBACK_MIN_TEXT_LENGTH) placeBadge(anchor, currentPageKey);
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleScan = () => {
    clearTimeout(timer);
    timer = setTimeout(scan, RESCAN_DEBOUNCE_MS);
  };

  scan();
  // Our own appends wake this observer once more; that pass finds everything
  // badged and settles.
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  ctx.addEventListener(window, "wxt:locationchange", scheduleScan);

  return () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const badge of badges.values()) badge.remove();
  };
}
