import { extractYoutubeVideoId } from "@cn/core/pageUrls";
import { readWatchPageChannel } from "./authorFeed";
import { youtubeChannelPath, youtubeChannelTarget, type CreatorTarget } from "./creatorTarget";
import type { MenuSite, MenuSubject } from "./menuRows";

// YouTube's three-dot menus: the one on every video card in a listing, and the
// one under the playing video. Every selector they depend on lives here. Most
// come from Tidy Web's src/content/video-menu.ts, which was checked against
// the live site.

// The menu buttons. YouTube draws cards in two generations of markup, the
// older ytd-menu-renderer and the newer lockup view model, and the last entry
// is the newer generation's three-dot icon itself.
const TRIGGER_SELECTOR =
  'ytd-menu-renderer, .ytLockupMetadataViewModelMenuButton, .yt-lockup-metadata-view-model__menu-button, button:has(svg path[d^="M12 4a2 2 0 100 4 2 2 0 000-4Zm0 6"])';
// The menu under the playing video shares its ytd-menu-renderer with Like,
// Share and Save, so only its own dropdown button counts as its trigger.
const WATCH_TRIGGER_SELECTOR = "ytd-watch-metadata #actions ytd-menu-renderer > :is(#button-shape, yt-icon-button#button)";
const CARD_SELECTOR =
  "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model";
const CARD_TITLE_SELECTOR = "#video-title, .ytLockupMetadataViewModelTitle, h3";
const WATCH_TITLE_SELECTOR = "ytd-watch-metadata h1";
// Both generations of YouTube's popup menu. Only one is open at a time.
const MENU_SELECTOR = 'ytd-popup-container yt-list-view-model[role="menu"], ytd-popup-container ytd-menu-popup-renderer #items';

const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

function watchPageSubject(): MenuSubject | null {
  const videoId = extractYoutubeVideoId(location.href);
  if (!videoId) return null;
  return {
    pageUrl: watchUrl(videoId),
    title: document.querySelector(WATCH_TITLE_SELECTOR)?.textContent?.trim() ?? document.title,
    noun: "video",
    currentPage: true,
    creator: async () => {
      const channel = readWatchPageChannel();
      return channel ? youtubeChannelTarget(channel.href, channel.name.trim()) : null;
    },
  };
}

/** A card's video is the one its first link plays. The first link is the
 *  thumbnail. A card for a podcast, playlist or Short starts with another kind
 *  of link and gets no rows, even when its text links to single episodes. */
function cardSubject(card: Element): MenuSubject | null {
  const href = card.querySelector<HTMLAnchorElement>("a[href]")?.href;
  const videoId = href ? extractYoutubeVideoId(href) : null;
  if (!videoId || !/\/watch\?/.test(href!)) return null;
  // Some cards, such as the ones beside a playing video, name their channel
  // without linking it. Those get only the video's row.
  const channelLink = [...card.querySelectorAll<HTMLAnchorElement>("a[href]")].find(
    (link) => youtubeChannelPath(link.href) && link.textContent?.trim(),
  );
  const creator: CreatorTarget | null = channelLink ? youtubeChannelTarget(channelLink.href, channelLink.textContent!.trim()) : null;
  return {
    pageUrl: watchUrl(videoId),
    title: card.querySelector(CARD_TITLE_SELECTOR)?.textContent?.trim() ?? "",
    noun: "video",
    currentPage: false,
    creator: async () => creator,
  };
}

export const youtubeMenuSite: MenuSite = {
  name: "youtube",
  triggerFor(target) {
    if (!target.closest('button, yt-icon-button, [role="button"]')) return null;
    return target.closest<HTMLElement>(WATCH_TRIGGER_SELECTOR) ?? target.closest<HTMLElement>(TRIGGER_SELECTOR);
  },
  subjectFor(trigger) {
    if (trigger.matches(WATCH_TRIGGER_SELECTOR)) return watchPageSubject();
    // The watch page's other buttons, such as Like and Share, sit in the same
    // ytd-menu-renderer and match the general selector. They open no menu of
    // ours.
    if (trigger.closest("ytd-watch-metadata")) return null;
    const card = trigger.closest(CARD_SELECTOR);
    return card ? cardSubject(card) : null;
  },
  // YouTube keeps a closed popup in the page, so we pick the one on screen.
  menuFor() {
    return [...document.querySelectorAll<HTMLElement>(MENU_SELECTOR)].find((menu) => menu.getClientRects().length > 0) ?? null;
  },
  mount(group, menu) {
    menu.prepend(group);
  },
  // The older dropdown fixes its height when it opens, before our rows exist.
  // Its own resize event makes it measure again, so no row is cut off.
  refit(menu) {
    menu.closest("tp-yt-iron-dropdown")?.dispatchEvent(new CustomEvent("iron-resize"));
  },
};
