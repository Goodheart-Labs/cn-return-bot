/** The site checks for what the extension reads out of pages. Most of them
 *  open the page in headless Chromium with the built extension loaded, the
 *  way the devbox's preview script does, and look at what the extension did
 *  there: the notes it anchored, the badges it placed, the menu rows it added,
 *  and the creator its page readers found. The page readers run in the page
 *  the same way the popup runs them, serialized into it. The extension's few
 *  plain API calls run here directly. */
import type { BrowserContext, Locator, Page } from "playwright";
import { openPage, waitForBadges } from "../everything-extension/scripts/browser";
import {
  forumPostAuthorTarget,
  readForumPostAuthorFromPage,
  readSubstackPublicationFromPage,
  readWatchPageChannel,
  resolveProfileCreatorTarget,
} from "../everything-extension/utils/creatorTarget";
import {
  SUBSTACK_MENU_TRIGGER,
  YOUTUBE_CARD,
  YOUTUBE_MENU_TRIGGER,
  YOUTUBE_WATCH_MENU_TRIGGER,
} from "../everything-extension/utils/menuTriggers";
import { fetchReaderCanonical } from "../everything-core/pageUrls";
import { CannotRunError, must, type SiteCheck } from "./siteCheck";
import * as pages from "./pages";

const LOG_POLL_MS = 500;
/** A cold page with the extension's first sync can take this long before the
 *  notes are anchored. */
const LOG_WAIT_MS = 45_000;
/** YouTube and the forums render their pages after loading them. */
const PAGE_SETTLE_MS = 6000;
const MENU_ROWS_WAIT_MS = 5000;
/** What YouTube's player shows instead of the video when it wants the viewer
 *  to sign in and prove they are not a bot. */
const YOUTUBE_PLAYER_REFUSAL = "yt-playability-error-supported-renderers, #movie_player .ytp-error";
/** How Chromium reports a page load that the proxy refused. */
const PROXY_REFUSAL = /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_PROXY_AUTH/;

/** Opens `url`, hands the page and the extension's console lines to `use`,
 *  and closes the page again. */
async function withPage<T>(context: BrowserContext, url: string, use: (page: Page, lines: string[]) => Promise<T>): Promise<T> {
  const lines: string[] = [];
  const page = await openPage(context, url, (line) => lines.push(line));
  try {
    return await use(page, lines);
  } finally {
    await page.close();
  }
}

/** Waits until the extension logs a line that matches `pattern`. */
async function waitForLog(page: Page, lines: string[], pattern: RegExp): Promise<RegExpMatchArray> {
  for (let waited = 0; waited < LOG_WAIT_MS; waited += LOG_POLL_MS) {
    const match = lines.map((line) => line.match(pattern)).find(Boolean);
    if (match) return match;
    await page.waitForTimeout(LOG_POLL_MS);
  }
  throw new Error(`the extension never logged ${pattern}. It logged: ${lines.join(" | ") || "nothing"}`);
}

/** Clicks a site's three-dot menu button and returns the labels of our rows
 *  in the menu that opens. */
async function ourMenuRows(page: Page, trigger: Locator): Promise<string[]> {
  await trigger.click();
  await page.locator(".cn-menu-row").first().waitFor({ timeout: MENU_ROWS_WAIT_MS }).catch(() => {});
  return page.locator(".cn-menu-row").allTextContents();
}

/** Opens a YouTube watch page and waits until the player has loaded. YouTube
 *  refuses to play videos to datacenter addresses, and then the player, the
 *  owner box and the menus never fill. Such a check cannot run, and neither
 *  can one whose connection the residential proxy refused, for example
 *  because its paid traffic ran out. A dead proxy fails the captions check
 *  already, so it does not fail these as well. */
async function withPlayingVideo<T>(context: BrowserContext, url: string, use: (page: Page, lines: string[]) => Promise<T>): Promise<T> {
  try {
    return await withPage(context, url, async (page, lines) => {
      await page.waitForTimeout(PAGE_SETTLE_MS);
      const refusal = page.locator(YOUTUBE_PLAYER_REFUSAL).locator("visible=true");
      if ((await refusal.count()) > 0) {
        const reason = (await refusal.first().innerText()).trim().replace(/\s+/g, " ").slice(0, 120);
        throw new CannotRunError(`YouTube would not play the video to this machine: "${reason}"`);
      }
      return use(page, lines);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (PROXY_REFUSAL.test(message)) throw new CannotRunError(`the residential proxy refused the connection: ${message.split("\n")[0]}`);
    throw err;
  }
}

function anchoringCheck(context: BrowserContext, site: SiteCheck["site"], name: string, url: string): SiteCheck {
  return {
    site,
    name: `Every note on a ${name} is anchored to its passage`,
    code: "mountInlineNotes, findContainer and anchorGroups (src/everything-extension/utils/)",
    run: () => anchorEveryClaim(context, url),
  };
}

function badgeCheck(context: BrowserContext, site: SiteCheck["site"], name: string, url: string): SiteCheck {
  return {
    site,
    name: `Listing badges appear on ${name}`,
    code: "mountCoverageBadges and its card rules (src/everything-extension/utils/coverageBadges.ts)",
    run: () => countBadges(context, url),
  };
}

function forumPageAuthorCheck(context: BrowserContext, name: string, post: { url: string; author: string }): SiteCheck {
  return {
    site: "Forums",
    name: `The author of ${name} post is read out of the page`,
    code: "readForumPostAuthorFromPage (src/everything-extension/utils/creatorTarget.ts)",
    run: () =>
      withPage(context, post.url, async (page) => {
        await page.waitForTimeout(PAGE_SETTLE_MS);
        const author = await page.evaluate(readForumPostAuthorFromPage);
        must(author?.href === post.author, `the page reader found the author ${author?.href ?? "nobody"}, not ${post.author}`);
        return author.name;
      }),
  };
}

function anchorEveryClaim(context: BrowserContext, url: string): Promise<string> {
  return withPage(context, url, async (page, lines) => {
    const [, anchored, total] = (await waitForLog(page, lines, /anchored (\d+)\/(\d+) claims/)).map(Number);
    must(total! > 0, "the page has no claims with notes any more, so it needs replacing in src/site-checks/pages.ts");
    must(anchored === total, `only ${anchored} of ${total} claims were anchored`);
    return `${anchored} of ${total} claims anchored`;
  });
}

function countBadges(context: BrowserContext, url: string): Promise<string> {
  return withPage(context, url, async (page, lines) => {
    const badges = await waitForBadges(page);
    const summary = lines.filter((line) => line.includes("listing badges")).at(-1) ?? "no summary logged";
    must(badges > 0, `no badge was placed. The extension said: ${summary}`);
    return `${badges} badges`;
  });
}

/** The checks that open pages run in `context`, one headless Chromium with
 *  the built extension that all of them share. */
export const extensionChecks = (context: BrowserContext): SiteCheck[] => [
  {
    site: "Substack",
    name: "A newsletter on its own domain is recognised as a Substack publication",
    code: "readSubstackPublicationFromPage (src/everything-extension/utils/creatorTarget.ts)",
    run: () =>
      withPage(context, pages.CUSTOM_DOMAIN_SUBSTACK_POST, async (page) => {
        const publication = await page.evaluate(readSubstackPublicationFromPage);
        must(
          publication?.subdomain === pages.CUSTOM_DOMAIN_SUBSTACK.subdomain,
          `the page reader found the publication ${publication?.subdomain ?? "none"}`,
        );
        return `${publication.subdomain}, "${publication.name}"`;
      }),
  },
  anchoringCheck(context, "Substack", "newsletter on its own domain", pages.CUSTOM_DOMAIN_SUBSTACK_POST),
  anchoringCheck(context, "Substack", "*.substack.com post", pages.SUBSTACK_POST),
  badgeCheck(context, "Substack", "a newsletter's archive on its own domain", pages.CUSTOM_DOMAIN_SUBSTACK_ARCHIVE),
  badgeCheck(context, "Substack", "a *.substack.com archive", pages.SUBSTACK_ARCHIVE),
  {
    site: "Substack",
    name: "Our rows appear in a post's three-dot menu on a newsletter's own domain",
    code: "substackMenuSite (src/everything-extension/utils/substackMenuRows.ts) and installMenuRows",
    run: () =>
      withPage(context, pages.CUSTOM_DOMAIN_SUBSTACK_POST, async (page) => {
        await page.waitForTimeout(PAGE_SETTLE_MS);
        const rows = await ourMenuRows(page, page.locator(SUBSTACK_MENU_TRIGGER).locator("visible=true").first());
        // The post is checked, so its only row is the author's. A week of
        // priority for the author removes that row too.
        must(rows.length > 0, "the menu got no rows. Either Substack's menu changed, or someone gave Astral Codex Ten priority this week");
        return rows.join(" · ");
      }),
  },
  {
    site: "Substack",
    name: "The profile API names a writer's publication for the extension",
    code: "resolveProfileCreatorTarget (src/everything-extension/utils/creatorTarget.ts)",
    run: async () => {
      const target = await resolveProfileCreatorTarget(pages.SUBSTACK_PROFILE_HANDLE);
      must(target?.feedUrl === pages.SUBSTACK_PUBLICATION, `the profile resolved to ${target?.feedUrl ?? "nothing"}`);
      return target.title;
    },
  },
  {
    site: "Substack",
    name: "A post link in Substack's reader app leads to the post's own address",
    code: "fetchReaderCanonical (src/everything-core/pageUrls.ts)",
    run: async () => {
      const canonical = await fetchReaderCanonical(pages.SUBSTACK_READER_LINK);
      must(canonical === pages.CUSTOM_DOMAIN_SUBSTACK_POST, `the reader link led to ${canonical ?? "nothing"}`);
      return canonical;
    },
  },
  badgeCheck(context, "YouTube", "a channel's videos page", pages.YOUTUBE_CHANNEL_VIDEOS),
  {
    site: "YouTube",
    name: "Our rows appear in a video card's three-dot menu",
    code: "youtubeMenuSite (src/everything-extension/utils/youtubeMenuRows.ts) and installMenuRows",
    run: () =>
      withPage(context, pages.YOUTUBE_CHANNEL_VIDEOS, async (page) => {
        await page.waitForTimeout(PAGE_SETTLE_MS);
        // A card's buttons appear when the pointer is over it.
        const card = page.locator(YOUTUBE_CARD).locator("visible=true").first();
        await card.hover();
        const rows = await ourMenuRows(page, card.locator(YOUTUBE_MENU_TRIGGER).locator("visible=true").last());
        // The newest video gets "Check this video" until we check it, and
        // the channel's row until someone gives it priority.
        must(rows.length > 0, "the card's menu got no rows. Either YouTube's menu changed, or its newest video is checked and the channel has priority");
        return rows.join(" · ");
      }),
  },
  forumPageAuthorCheck(context, "a LessWrong", pages.LESSWRONG_POST),
  forumPageAuthorCheck(context, "an Alignment Forum", pages.ALIGNMENT_FORUM_POST),
  forumPageAuthorCheck(context, "an EA Forum", pages.EA_FORUM_POST),
  {
    site: "Forums",
    name: "The extension asks LessWrong's and the Alignment Forum's API for a post's author",
    code: "forumPostAuthorTarget (src/everything-extension/utils/creatorTarget.ts)",
    run: async () => {
      const found = [];
      for (const post of [pages.LESSWRONG_POST, pages.ALIGNMENT_FORUM_POST]) {
        const target = await forumPostAuthorTarget(post.url);
        must(target?.feedUrl === post.author, `the API named ${target?.feedUrl ?? "nobody"} as the author of ${post.url}`);
        found.push(target.title);
      }
      return found.join(" · ");
    },
  },
  anchoringCheck(context, "Forums", "LessWrong post", pages.LESSWRONG_POST.url),
  badgeCheck(context, "Forums", "a LessWrong author's page", pages.LESSWRONG_AUTHOR),
];

/** The checks on a YouTube watch page. YouTube will not play a video to a
 *  datacenter address, so run.ts opens these pages in a second browser that
 *  goes through the residential proxy. */
export const watchPageChecks = (context: BrowserContext): SiteCheck[] => [
  {
    site: "YouTube",
    name: "A watch page's channel is read out of the page",
    code: "readWatchPageChannel (src/everything-extension/utils/creatorTarget.ts)",
    run: () =>
      withPlayingVideo(context, pages.YOUTUBE_VIDEO.url, async (page) => {
        const channel = await page.evaluate(readWatchPageChannel);
        must(channel && new URL(channel.href).pathname === pages.YOUTUBE_VIDEO.channelPath, `the page reader found the channel ${channel?.href ?? "none"}`);
        return channel.name.trim();
      }),
  },
  {
    site: "YouTube",
    name: "A video's notes show as pins on the player's progress bar",
    code: "youtube.content.tsx, youtubePlayer.ts and ScrubberPins.tsx (src/everything-extension/)",
    run: () =>
      withPlayingVideo(context, pages.YOUTUBE_VIDEO.url, async (page, lines) => {
        const [, claims] = await waitForLog(page, lines, /(\d+) timestamped claims on this video/);
        await page.locator(".cn-scrub-pin").first().waitFor({ timeout: LOG_WAIT_MS }).catch(() => {});
        const pins = await page.locator(".cn-scrub-pin").count();
        must(pins > 0, `the video has ${claims} timestamped claims, but no pin was drawn on the progress bar`);
        return `${claims} timestamped claims, ${pins} pins`;
      }),
  },
  {
    site: "YouTube",
    name: "Our rows appear in the three-dot menu under a playing video",
    code: "youtubeMenuSite (src/everything-extension/utils/youtubeMenuRows.ts) and installMenuRows",
    run: () =>
      withPlayingVideo(context, pages.YOUTUBE_UNFOLLOWED_VIDEO, async (page) => {
        const rows = await ourMenuRows(page, page.locator(YOUTUBE_WATCH_MENU_TRIGGER).locator("visible=true").first());
        must(rows.length > 0, "the menu under the video got no rows");
        return rows.join(" · ");
      }),
  },
];
