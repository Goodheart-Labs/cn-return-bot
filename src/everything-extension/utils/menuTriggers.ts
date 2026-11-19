// The selectors that find a site's three-dot menu buttons and YouTube's video
// cards. They live apart from substackMenuRows.ts and youtubeMenuRows.ts so
// that the daily site checks (src/site-checks/) can click the same buttons,
// without loading the extension's browser APIs.

export const SUBSTACK_MENU_TRIGGER = 'button[aria-haspopup="menu"]:is(:has(svg.lucide-ellipsis), [class*="moreButton-"])';

// YouTube draws cards in two generations of markup, the older
// ytd-menu-renderer and the newer lockup view model, and the last entry is the
// newer generation's three-dot icon itself.
export const YOUTUBE_MENU_TRIGGER =
  'ytd-menu-renderer, .ytLockupMetadataViewModelMenuButton, .yt-lockup-metadata-view-model__menu-button, button:has(svg path[d^="M12 4a2 2 0 100 4 2 2 0 000-4Zm0 6"])';
// The menu under the playing video shares its ytd-menu-renderer with Like,
// Share and Save, so only its own dropdown button counts as its trigger.
export const YOUTUBE_WATCH_MENU_TRIGGER = "ytd-watch-metadata #actions ytd-menu-renderer > :is(#button-shape, yt-icon-button#button)";
export const YOUTUBE_CARD =
  "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model";
