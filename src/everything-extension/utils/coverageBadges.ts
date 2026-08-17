import type { ContentScriptContext } from "#imports";
import { extractYoutubeVideoId, normalizePageUrl } from "../../everything-shared/pageUrls";
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

// The fallback for links that do not wrap a picture themselves: such a link
// only gets a badge when it sits inside a listing card, and the badge goes on
// that card's picture or corner. Substack wraps each feed entry in
// role="article"; article and li catch listings on generic sites. YouTube
// never needs this path, because its tiles always contain a thumbnail link.
// The height cap tells a card apart from a full article body that merely
// links to another noted post. Links outside any card get no badge at all:
// appended inline they ended up dangling under hero titles or stretched
// across cards, which is what this replaced.
const CARD_SELECTOR = '[role="article"], article, li';
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

// Avatars and icons are small, so anything under this area cannot be the
// cover image.
const MIN_COVER_IMAGE_AREA_PX = 120 * 68;

/** The largest image under `root` that is big enough to be a cover image or
 *  thumbnail rather than an avatar or icon. */
function coverImage(root: HTMLElement): HTMLElement | null {
  let cover: HTMLElement | null = null;
  let coverArea = MIN_COVER_IMAGE_AREA_PX;
  for (const image of root.querySelectorAll<HTMLElement>("img")) {
    const area = image.offsetWidth * image.offsetHeight;
    if (area >= coverArea) {
      cover = image;
      coverArea = area;
    }
  }
  return cover;
}

/** The element the badge is pinned to, or null when this link should carry no
 *  badge. A link that wraps the tile's picture is the preferred surface: every
 *  video tile has one, whatever the host's current component names are, and it
 *  pins the badge to the picture's corner, clear of the card's own controls.
 *  Matching on structure rather than on component tag names is deliberate:
 *  YouTube renders different tile components logged in than logged out, and a
 *  tag-name list silently missed the logged-in ones. A text link falls back to
 *  its listing card, where the badge sits on the card's picture if it has one
 *  and on the card's corner otherwise. */
function surfaceFor(anchor: HTMLAnchorElement): HTMLElement | null {
  if (coverImage(anchor)) return anchor;
  const card = anchor.closest<HTMLElement>(CARD_SELECTOR);
  if (!card || card.offsetHeight > CARD_MAX_HEIGHT_PX) return null;
  return coverImage(card)?.parentElement ?? card;
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

  // The one badge each noted page currently has, together with the link that
  // earned it, so a page linked several times in one listing is badged once.
  const badges = new Map<string, { badge: HTMLElement; anchor: HTMLAnchorElement }>();

  /** Puts the badge on the best surface its link currently offers. Calling it
   *  again is harmless, and that matters: cover images lazy-load, so the first
   *  scan can run while the picture still has no size. The badge then starts
   *  on the card's corner, and a later scan moves it onto the picture. */
  const seat = (badge: HTMLElement, surface: HTMLElement) => {
    if (badge.parentElement === surface) return;
    // The badge is positioned against the surface, so the surface must be a
    // containing block. Almost every one already is; for the rare static one
    // this is the only style we touch on the host page.
    if (getComputedStyle(surface).position === "static") surface.style.position = "relative";
    surface.appendChild(badge);
  };

  /** Drops every badge whose link no longer leads to its page. Hosts recycle
   *  their tile nodes: YouTube keeps a card element connected while swapping
   *  it to a different video during scrolling. Trusting isConnected alone left
   *  a badge sitting on the wrong video and blocked the right tile from ever
   *  getting one. A valid badge is re-seated, which moves it onto the picture
   *  once a lazy-loaded image has arrived. */
  const pruneAndReseat = () => {
    for (const [key, { badge, anchor }] of badges) {
      const valid = badge.isConnected && anchor.isConnected && pageKey(anchor.href) === key;
      const surface = valid ? surfaceFor(anchor) : null;
      if (surface) {
        seat(badge, surface);
      } else {
        badge.remove();
        badges.delete(key);
      }
    }
  };

  const placeBadge = (anchor: HTMLAnchorElement, currentKeys: Set<string>) => {
    const key = pageKey(anchor.href);
    if (!key || currentKeys.has(key) || badges.has(key)) return;
    const count = countByKey.get(key);
    if (!count) return;
    const surface = surfaceFor(anchor);
    if (!surface) return;
    const badge = createBadge(count);
    seat(badge, surface);
    badges.set(key, { badge, anchor });
  };

  const scan = () => {
    pruneAndReseat();
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
  // An image that finishes loading fires no DOM mutation, but it is exactly
  // the moment a badge wants to move from the card's corner onto the picture.
  // load events do not bubble; a capture listener on the document still sees
  // every one of them.
  const onLoad = () => scheduleScan();
  document.addEventListener("load", onLoad, { capture: true, passive: true });

  return () => {
    observer.disconnect();
    document.removeEventListener("load", onLoad, { capture: true } as EventListenerOptions);
    clearTimeout(timer);
    for (const { badge } of badges.values()) badge.remove();
  };
}
