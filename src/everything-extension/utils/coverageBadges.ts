import { browser } from "#imports";
import { MARKER_DARK, MARKER_GLYPH_SIZE, MARKER_HOVER_SCALE, MARKER_LIGHT, MARKER_SHADOW } from "./markerPalette";
import type { ContentScriptContext } from "#imports";
import type { BadgeMark } from "../components/BadgeCard";
import { mountBadgeCard, type BadgeCardHandle } from "./mountBadgeCard";
import { extractYoutubeVideoId, normalizePageUrl } from "@cn/core/pageUrls";
import { NOTE_STACK_GLYPH_PATH } from "@cn/ui/icons";
import { getNotedPageStatusCounts, getWholePageCheckedUrls, trimSlash } from "./coveredPages";
import { isPageDark } from "./pageTheme";
import type { NoteStatus } from "@cn/core/noteScore";
import { getNoteDisplay, getSettings, onNoteDisplayChanged } from "./settings";

// The badges that mark noted posts in a listing, for example on a Substack
// publication's front page or a YouTube channel's videos tab. Every listing
// card that leads to a page with notes gets a small circle in an upper corner
// with the community glyph and the number of notes there. The counts come
// from the locally synced cache, so drawing badges costs no backend request.
// A click on the circle opens a small card that says what it means.

const RESCAN_DEBOUNCE_MS = 600;
const BADGE_CLASS = "cn-coverage-badge";
const BADGE_INSET = "6px";

// The badge sits in the right-hand corner of its surface, except on YouTube.
// There, hovering a thumbnail shows YouTube's own "Watch later" and "Add to
// queue" buttons in its upper right corner, stacked above anything we put
// there. The badge was hidden under them whenever the pointer was on the
// thumbnail, so a reader could never click it. YouTube leaves the upper left
// corner empty.
const BADGE_SIDE: "left" | "right" = /(^|\.)youtube\.com$/.test(location.hostname) ? "left" : "right";

// The fallback for links that do not wrap a picture themselves: such a link
// only gets a badge when it sits inside a listing card or is one itself (see
// isCardLink), and the badge goes on that card's picture or corner. Substack
// wraps each feed entry in role="article"; article and li catch listings on
// generic sites. YouTube never needs this path, because its tiles always
// contain a thumbnail link. The height cap tells a card apart from a full
// article body that merely links to another noted post. Links outside any
// card get no badge at all: appended inline they ended up dangling under hero
// titles or stretched across cards, which is what this replaced.
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

// Substack's reader links a post as substack.com/home/post/p-<id> or
// /@author/p-<id>. The database only knows the publication's own post URL, so
// such a link cannot be matched directly. The background resolves each post id
// to that URL once, from the redirect a logged-out fetch gets or from the
// canonical embedded in the fetched page, and the mapping is kept in storage
// so a post the reader's feed showed once never needs resolving again.
const READER_CANONICALS_KEY = "cn:readerPostCanonicals";
const READER_CANONICALS_MAX = 2000;

/** The reader post id ("p-210916646") of a link, or null when the link is not
 *  a reader-style post link. */
function readerPostId(href: string): string | null {
  try {
    const url = new URL(href, location.href);
    if (!/^(www\.)?substack\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/\/(p-\d+)(\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** A small circle pinned to a card's upper corner. It uses the same surface as
 *  the in-article passage badge: a white circle with a border and the blue
 *  community glyph, plus the note count. A double-digit count widens it into
 *  a slight oval, which is fine.
 *  A checked page that produced no notes gets the same circle with a check
 *  mark instead of the count, so "we looked and found nothing" is visible in
 *  listings too.
 *  Under the mouse the badge grows a little, like the scrubber pins do, which
 *  tells the reader it can be clicked. The badge lives in the host page's own
 *  DOM, where we add no stylesheet, so the hover is two event listeners
 *  rather than a :hover rule. */
function createBadge(mark: BadgeMark): HTMLElement {
  const palette = isPageDark() ? MARKER_DARK : MARKER_LIGHT;
  const badge = document.createElement("span");
  badge.className = BADGE_CLASS;
  badge.setAttribute("role", "button");
  badge.tabIndex = 0;
  badge.setAttribute(
    "style",
    `position:absolute;${BADGE_SIDE}:${BADGE_INSET};z-index:10;cursor:pointer;transition:transform 120ms ease-out;` +
      "display:inline-flex;align-items:center;justify-content:center;" +
      "gap:2px;height:26px;min-width:26px;padding:0 6px;box-sizing:border-box;border-radius:9999px;" +
      `font-size:12px;line-height:1;font-weight:600;white-space:nowrap;box-shadow:${MARKER_SHADOW};` +
      `color:${palette.glyph};background:${palette.body};` +
      `border:1px solid ${palette.border};`,
  );
  badge.addEventListener("mouseenter", () => (badge.style.transform = `scale(${MARKER_HOVER_SCALE})`));
  badge.addEventListener("mouseleave", () => (badge.style.transform = ""));
  const svg = `<svg viewBox="0 0 24 24" width="${MARKER_GLYPH_SIZE}" height="${MARKER_GLYPH_SIZE}" fill="currentColor" aria-hidden="true" style="flex:none"><path fill-rule="evenodd" d="${NOTE_STACK_GLYPH_PATH}"/></svg>`;
  if ("count" in mark) {
    badge.setAttribute("aria-label", `${mark.count} Common ${mark.count === 1 ? "Note" : "Notes"}`);
    badge.innerHTML = `${svg}${mark.count}`;
  } else {
    badge.setAttribute("aria-label", "Fact-checked, nothing to correct");
    const check = `<svg viewBox="0 0 14 14" width="${MARKER_GLYPH_SIZE}" height="${MARKER_GLYPH_SIZE}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none"><path d="M3 7.5l2.5 2.5 5.5-6"/></svg>`;
    badge.innerHTML = `${svg}${check}`;
  }
  return badge;
}

/** Makes a click on the badge open its explanation card instead of what a
 *  click there used to do. The badge usually sits inside the link, and on
 *  Substack inside a note the whole card opens on click. So the click is
 *  cancelled and stopped at the badge: preventDefault keeps the browser from
 *  following the link, and stopPropagation keeps the host page's own click
 *  handlers, which listen further up, from navigating. Enter and Space do the
 *  same for a reader on the keyboard. */
function onBadgeActivate(badge: HTMLElement, activate: () => void) {
  const handle = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    activate();
  };
  badge.addEventListener("click", handle);
  badge.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") handle(event);
  });
}

// Avatars and icons are small, so anything under this area cannot be the
// cover image. The bar is deliberately low: even a small thumbnail is a better
// badge surface than the card's corner, where the badge lands on top of dates
// and menus. A typical 40 to 48 pixel avatar stays under it.
const MIN_COVER_IMAGE_AREA_PX = 60 * 60;

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

/** The box that frames a picture on screen, so the badge can sit in the
 *  picture's own corner. An image that is absolutely positioned fills its
 *  containing block, which is its offsetParent. That element is already
 *  positioned, so the badge can use it without any style change.
 *  Otherwise the frame is the image's nearest ancestor that draws a block box.
 *  Two kinds of wrapper are skipped. Substack wraps its thumbnails in a
 *  <picture> with display: contents, which draws no box of its own, so a
 *  badge positioned against it would land in the corner of some larger
 *  ancestor instead. YouTube wraps them in a <yt-image> that is an inline
 *  element, whose box is only one line of text tall. A badge positioned
 *  against it sat on the thumbnail's bottom edge, where the thumbnail's
 *  rounded corners clipped it away (October 2026). */
const WRAPPER_DISPLAYS_WITHOUT_A_FRAME = new Set(["contents", "inline"]);

function pictureFrame(image: HTMLElement): HTMLElement {
  if (getComputedStyle(image).position === "absolute" && image.offsetParent instanceof HTMLElement) return image.offsetParent;
  let frame = image.parentElement!;
  while (WRAPPER_DISPLAYS_WITHOUT_A_FRAME.has(getComputedStyle(frame).display)) frame = frame.parentElement!;
  return frame;
}

// A link can also be the card itself. A Substack profile's Posts tab wraps
// each post row in one link, inside plain divs that match no card selector. A
// row whose post has no cover picture then had nowhere to put its badge. Such
// a link is told apart from a text link by its box: it lays out as a block and
// is at least as tall as a few lines of text. The row shows its date in its
// upper right corner, so the badge goes into the lower right one, which
// Substack leaves empty.
const MIN_CARD_LINK_HEIGHT_PX = 80;

function isCardLink(anchor: HTMLAnchorElement): boolean {
  return (
    !WRAPPER_DISPLAYS_WITHOUT_A_FRAME.has(getComputedStyle(anchor).display) &&
    anchor.offsetHeight >= MIN_CARD_LINK_HEIGHT_PX &&
    anchor.offsetHeight <= CARD_MAX_HEIGHT_PX
  );
}

// A text link in running text is part of what someone wrote, not an entry in
// a listing. Every bullet point of an Astral Codex Ten post that ended in a
// "(source)" link to a checked page got a badge, because each bullet is an li
// and so counted as a card (GOO-393). A link in a reader's comment did the
// same. A link is in running text when the text block around it holds much
// more text than the link itself. A listing's title link is all or most of
// its block, as in <h3><a>Title</a></h3>.
// A link that shows its own web address is written text too, even when it
// fills its block. A reader pastes the address into a comment, and Substack
// shows the addresses of a note's links on their own line. A listing never
// uses an address as a post's title. The pattern needs a protocol or a path,
// so a title such as "Node.js" is not mistaken for an address.
const MIN_TITLE_SHARE_OF_BLOCK_TEXT = 0.5;
const BARE_ADDRESS = /^(https?:\/\/\S+|[\w-]+(\.[\w-]+)+\/\S*)$/;

function isInRunningText(anchor: HTMLAnchorElement): boolean {
  const linkText = (anchor.textContent ?? "").trim();
  if (BARE_ADDRESS.test(linkText)) return true;
  let block = anchor.parentElement;
  while (block && WRAPPER_DISPLAYS_WITHOUT_A_FRAME.has(getComputedStyle(block).display)) block = block.parentElement;
  if (!block) return false;
  return linkText.length < (block.textContent ?? "").trim().length * MIN_TITLE_SHARE_OF_BLOCK_TEXT;
}

/** Where a badge sits: the element it is pinned to, and which of that
 *  element's corners on BADGE_SIDE it takes. */
type BadgeSpot = { surface: HTMLElement; corner: "top" | "bottom" };

/** The element the badge is pinned to, or null when this link should carry no
 *  badge. The rules are tried in this order.
 *
 *  1. A link that wraps a picture gets the badge in the picture's corner,
 *     clear of the card's dates and menus. On YouTube the link is the
 *     thumbnail itself. On a Substack profile's post list the link is the
 *     whole row, and pinning the badge to the link put it over the row's date.
 *     Matching on structure rather than on component tag names is deliberate:
 *     YouTube renders different tile components logged in than logged out,
 *     and a tag-name list silently missed the logged-in ones.
 *  2. A link that is a card by itself, with no picture, carries the badge in
 *     its own corner. Inside a bigger card this is a preview box, such as the
 *     quote a Substack note shares from a post, and its upper corner is free.
 *     Outside any card it is a row of a profile's post list, whose upper corner
 *     shows the date, so the badge takes the lower one.
 *  3. A text link nested inside another link gets no badge. Substack shows an
 *     embedded note as one big link, with the note's own links inside it. The
 *     inner link used to send its badge to the largest picture of the
 *     surrounding note, which had nothing to do with the linked post
 *     (GOO-393). A text link in running text gets no badge either.
 *  4. Any other text link falls back to its listing card. The badge sits on
 *     the card's picture if it has one and on the card's corner otherwise. */
function spotFor(anchor: HTMLAnchorElement): BadgeSpot | null {
  const linkPicture = coverImage(anchor);
  if (linkPicture) return { surface: pictureFrame(linkPicture), corner: "top" };
  const card = anchor.closest<HTMLElement>(CARD_SELECTOR);
  if (isCardLink(anchor)) return { surface: anchor, corner: card ? "top" : "bottom" };
  if (anchor.parentElement?.closest("a[href]") || isInRunningText(anchor)) return null;
  if (!card || card.offsetHeight > CARD_MAX_HEIGHT_PX) return null;
  const cardPicture = coverImage(card);
  return { surface: cardPicture ? pictureFrame(cardPicture) : card, corner: "top" };
}

/** Marks every listing link that leads to a noted page with a note-count
 *  badge, placed where spotFor says. The scan re-runs debounced on DOM changes,
 *  which covers infinite scroll and single-page-app navigations. Every card
 *  that links a noted page gets one badge, however often the page is listed.
 *  A badge the host page threw away in a re-render is simply placed again on
 *  the next scan. Returns a teardown
 *  function, or null when the counts have never been synced. */
export async function mountCoverageBadges(ctx: ContentScriptContext): Promise<(() => void) | null> {
  if (!(await getSettings()).showThumbnailBadges) return null;
  const statusCounts = (await getNotedPageStatusCounts()) ?? {};
  // A checked page with no notes at all gets its own badge saying we looked
  // and found nothing. Pages whose notes exist but are all hidden by the
  // reader's display choices are not in that set: for them silence stays honest.
  const notedKeys = new Set<string>();
  for (const url of Object.keys(statusCounts)) {
    const key = pageKey(url);
    if (key) notedKeys.add(key);
  }
  const checkedNoNotesKeys = new Set<string>();
  for (const url of (await getWholePageCheckedUrls()) ?? []) {
    const key = pageKey(url);
    if (key && !notedKeys.has(key)) checkedNoNotesKeys.add(key);
  }
  if (notedKeys.size === 0 && checkedNoNotesKeys.size === 0) return null;

  // A badge promises what opening the page will actually show, so it counts
  // only the notes the reader has not hidden. Collapsed notes count, because
  // they still get a marker on the page. The map is rebuilt when the display
  // choices change.
  const countByKey = new Map<string, number>();
  const rebuildCounts = async () => {
    const display = await getNoteDisplay();
    const shown = (status: NoteStatus, count: number) => (display[status] === "hide" ? 0 : count);
    countByKey.clear();
    for (const [url, page] of Object.entries(statusCounts)) {
      const count =
        shown("helpful", page.helpful) +
        shown("needs_ratings", page.needsRatings) +
        shown("not_helpful", page.notHelpful);
      if (count === 0) continue;
      const key = pageKey(url);
      if (key) countByKey.set(key, (countByKey.get(key) ?? 0) + count);
    }
  };
  await rebuildCounts();

  const readerCanonicals = new Map<string, string>(
    Object.entries(
      ((await browser.storage.local.get(READER_CANONICALS_KEY))[READER_CANONICALS_KEY] as Record<string, string> | undefined) ?? {},
    ),
  );
  const readerResolving = new Set<string>();

  const persistReaderCanonicals = () => {
    // Insertion order is oldest first, so trimming from the front drops the
    // posts the reader has not seen for the longest.
    const entries = [...readerCanonicals.entries()].slice(-READER_CANONICALS_MAX);
    void browser.storage.local.set({ [READER_CANONICALS_KEY]: Object.fromEntries(entries) }).catch(() => {});
  };

  /** Asks the background to resolve one reader post link. Each post id is
   *  tried once per mount; a resolved id triggers a rescan so the link gets
   *  its badge without any user action. */
  const resolveReaderLink = (href: string, postId: string) => {
    if (readerResolving.has(postId)) return;
    readerResolving.add(postId);
    void browser.runtime
      .sendMessage({ type: "cn-reader-canonical", href })
      .then((url) => {
        if (typeof url !== "string" || !url) return;
        readerCanonicals.set(postId, url);
        persistReaderCanonicals();
        scheduleScan();
      })
      .catch(() => {});
  };

  /** The lookup key of a link, with reader-style post links translated to the
   *  publication URL they lead to. A reader link whose translation is not
   *  known yet gets none, and its resolution is kicked off instead. */
  const keyFor = (href: string): string | null => {
    const postId = readerPostId(href);
    if (!postId) return pageKey(href);
    const canonical = readerCanonicals.get(postId);
    if (!canonical) {
      resolveReaderLink(new URL(href, location.href).toString(), postId);
      return null;
    }
    return pageKey(canonical);
  };

  // Every placed badge, by the link that earned it. A page listed twice, such
  // as a YouTube video that is both the channel's featured video and a tile in
  // a shelf below, gets a badge on each copy. Several links inside one card
  // lead to the same surface, and a surface carries one badge only.
  const badges = new Map<HTMLAnchorElement, { badge: HTMLElement; key: string }>();

  // The explanation card mounts on the first badge click, so a page whose
  // badges nobody clicks never gets the extra shadow root.
  let badgeCard: Promise<BadgeCardHandle> | null = null;
  const openBadgeCard = (badge: HTMLElement, mark: BadgeMark, anchor: HTMLAnchorElement) => {
    badgeCard ??= mountBadgeCard(ctx);
    const noun = extractYoutubeVideoId(anchor.href) ? "video" : "post";
    void badgeCard.then((card) => card.open(badge, mark, noun));
  };
  const hasBadge = (surface: HTMLElement) => [...surface.children].some((child) => child.classList.contains(BADGE_CLASS));

  /** Puts the badge on the best surface its link currently offers. Calling it
   *  again is harmless, and that matters: cover images lazy-load, so the first
   *  scan can run while the picture still has no size. The badge then starts
   *  on the card's corner, and a later scan moves it onto the picture. */
  const seat = (badge: HTMLElement, { surface, corner }: BadgeSpot) => {
    badge.style.top = corner === "top" ? BADGE_INSET : "";
    badge.style.bottom = corner === "bottom" ? BADGE_INSET : "";
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
    for (const [anchor, { badge, key }] of badges) {
      const valid = badge.isConnected && anchor.isConnected && keyFor(anchor.href) === key;
      const spot = valid ? spotFor(anchor) : null;
      if (spot && (badge.parentElement === spot.surface || !hasBadge(spot.surface))) {
        seat(badge, spot);
      } else {
        badge.remove();
        badges.delete(anchor);
      }
    }
  };

  /** Badges the link if it leads to a noted or checked page. Returns what
   *  happened, for the scan's summary line. */
  const placeBadge = (anchor: HTMLAnchorElement, currentKeys: Set<string>): "not-listed" | "badged" | "no-surface" => {
    if (badges.has(anchor)) return "badged";
    const key = keyFor(anchor.href);
    if (!key || currentKeys.has(key)) return "not-listed";
    const count = countByKey.get(key);
    if (!count && !checkedNoNotesKeys.has(key)) return "not-listed";
    const spot = spotFor(anchor);
    if (!spot) return "no-surface";
    // Another link in the same card already put its badge here.
    if (hasBadge(spot.surface)) return "badged";
    const mark: BadgeMark = count ? { count } : { checked: true };
    const badge = createBadge(mark);
    onBadgeActivate(badge, () => openBadgeCard(badge, mark, anchor));
    seat(badge, spot);
    badges.set(anchor, { badge, key });
    return "badged";
  };

  const scan = () => {
    pruneAndReseat();
    // Links to the page we are already on carry no information, so they get
    // no badge. The canonical URL counts as the current page too: on a
    // custom-domain newsletter the address bar and the stored item URL can
    // name different hosts for the same post. The canonical goes through
    // normalizePageUrl rather than being read raw, because that applies the
    // only-while-the-path-matches guard: after a client-side navigation back
    // to the front page, Substack leaves the previous post's canonical tag in
    // the head, and trusting it raw suppressed exactly that post's badge.
    // The current address is never translated like a reader link. A reader
    // page such as substack.com/@author/note/p-<id> shows the post as a card
    // with replies under it, not as the article. That card is the only place
    // the page can say the post was checked, so it must keep its badge.
    const currentKeys = new Set<string>();
    for (const href of [location.href, normalizePageUrl(location.href, document)]) {
      const key = pageKey(href);
      if (key) currentKeys.add(key);
    }
    const outcomes = { badged: 0, "no-surface": 0 };
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const outcome = placeBadge(anchor, currentKeys);
      if (outcome !== "not-listed") outcomes[outcome] += 1;
    }
    logScanSummary(`[common-notes] listing badges: ${outcomes.badged + outcomes["no-surface"]} links to noted pages, ${badges.size} badges on the page, ${outcomes["no-surface"]} links with no place for a badge`);
  };

  // The badges are otherwise silent, so a page that should show them and does
  // not gave no clue why (Safari, October 2026). The line is repeated only
  // when it changes, because every DOM change triggers a scan.
  let lastSummary = "";
  const logScanSummary = (summary: string) => {
    if (summary === lastSummary) return;
    lastSummary = summary;
    console.info(summary);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleScan = () => {
    clearTimeout(timer);
    timer = setTimeout(scan, RESCAN_DEBOUNCE_MS);
  };

  scan();
  // A display change alters the numbers, so every badge is rebuilt: the count
  // is baked into the badge element when it is created.
  const stopDisplay = onNoteDisplayChanged(() => {
    void rebuildCounts().then(() => {
      for (const { badge } of badges.values()) badge.remove();
      badges.clear();
      scan();
    });
  });
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
    stopDisplay();
    observer.disconnect();
    document.removeEventListener("load", onLoad, { capture: true } as EventListenerOptions);
    clearTimeout(timer);
    for (const { badge } of badges.values()) badge.remove();
    void badgeCard?.then((card) => card.teardown());
  };
}
