import type { ContentScriptContext } from "#imports";
import { extractYoutubeVideoId, normalizePageUrl } from "../../everything-shared/notesQuery";
import { GROUP_GLYPH_PATH } from "../components/ClaimNoteStack";
import { getNotedPageCounts, trimSlash } from "./coveredPages";
import { isPageDark } from "./pageTheme";

// The badges that mark noted posts in a listing, for example on a Substack
// publication's front page or a YouTube channel's videos tab. Every listing
// card that leads to a page with notes gets a small circle in its upper right
// with the community glyph and the number of notes there. The counts come
// from the locally synced cache, so drawing badges costs no backend request.

const RESCAN_DEBOUNCE_MS = 600;
const BADGE_CLASS = "cn-coverage-badge";

// A badge is only placed on a link that sits inside a listing card, and it is
// pinned to that card's corner. Substack wraps each feed entry in
// role="article"; the ytd-* elements are YouTube's video tiles; article and
// li catch listings on generic sites. The height cap tells a card apart from
// a full article body that merely links to another noted post. Links outside
// any card get no badge at all: appended inline they ended up dangling under
// hero titles or stretched across cards, which is what this replaced.
const CARD_SELECTOR = '[role="article"], ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer, article, li';
const CARD_MAX_HEIGHT_PX = 900;

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

/** A small circle pinned to a card's upper right. It uses the same surface as
 *  the in-article passage badge: a white circle with a border and the blue
 *  community glyph, plus the note count. A double-digit count widens it into
 *  a slight oval, which is fine. */
function createBadge(count: number): HTMLElement {
  const dark = isPageDark();
  const badge = document.createElement("span");
  badge.className = BADGE_CLASS;
  badge.title = `${count} Common ${count === 1 ? "Note" : "Notes"} on this page`;
  badge.setAttribute(
    "style",
    "position:absolute;top:6px;right:6px;z-index:10;display:inline-flex;align-items:center;justify-content:center;" +
      "gap:2px;height:26px;min-width:26px;padding:0 6px;box-sizing:border-box;border-radius:9999px;" +
      "font-size:11px;line-height:1;font-weight:600;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.25);" +
      `color:${dark ? "#60a5fa" : "#2563eb"};background:${dark ? "#111827" : "#ffffff"};` +
      `border:1px solid ${dark ? "#4b5563" : "#d1d5db"};`,
  );
  const svg = `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true" style="flex:none"><path d="${GROUP_GLYPH_PATH}"/></svg>`;
  badge.innerHTML = `${svg}${count}`;
  return badge;
}

/** The listing card a link belongs to, or null when the link is not part of a
 *  card. The anchor itself may be the card, which happens when a whole tile
 *  is one big link. */
function cardFor(anchor: HTMLAnchorElement): HTMLElement | null {
  const card = anchor.closest<HTMLElement>(CARD_SELECTOR);
  if (!card || card.offsetHeight > CARD_MAX_HEIGHT_PX) return null;
  return card;
}

// Avatars and icons are small, so anything under this area cannot be the
// cover image.
const MIN_COVER_IMAGE_AREA_PX = 120 * 68;

/** The element the badge is pinned to. When the card shows a cover image or
 *  video thumbnail, the badge belongs on that picture's corner, which reads
 *  better than the card's own corner and stays clear of the card's controls,
 *  such as Substack's dismiss button. The largest image wins; a text-only
 *  card falls back to the card itself. The badge goes into the picture's
 *  direct parent, which on both Substack and YouTube wraps the picture
 *  tightly. */
function badgeSurface(card: HTMLElement): HTMLElement {
  let cover: HTMLElement | null = null;
  let coverArea = MIN_COVER_IMAGE_AREA_PX;
  for (const image of card.querySelectorAll<HTMLElement>("img")) {
    const area = image.offsetWidth * image.offsetHeight;
    if (area >= coverArea) {
      cover = image;
      coverArea = area;
    }
  }
  return cover?.parentElement ?? card;
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

  const placeBadge = (anchor: HTMLAnchorElement, currentKeys: Set<string>) => {
    const key = pageKey(anchor.href);
    if (!key || currentKeys.has(key)) return;
    const count = countByKey.get(key);
    if (!count) return;
    if (badges.get(key)?.isConnected) return;
    const card = cardFor(anchor);
    if (!card) return;
    const surface = badgeSurface(card);
    // The badge is positioned against the surface, so the surface must be a
    // containing block. Almost every one already is; for the rare static one
    // this is the only style we touch on the host page.
    if (getComputedStyle(surface).position === "static") surface.style.position = "relative";
    const badge = createBadge(count);
    surface.appendChild(badge);
    badges.set(key, badge);
  };

  const scan = () => {
    // Links to the page we are already on carry no information, so they get
    // no badge. The canonical URL counts as the current page too: on a
    // custom-domain newsletter the address bar and the stored item URL can
    // name different hosts for the same post.
    const currentKeys = new Set<string>();
    for (const href of [location.href, document.querySelector('link[rel="canonical"]')?.getAttribute("href")]) {
      const key = href ? pageKey(href) : null;
      if (key) currentKeys.add(key);
    }
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) placeBadge(anchor, currentKeys);
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
