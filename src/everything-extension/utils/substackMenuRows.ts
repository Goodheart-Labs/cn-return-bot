import { isSubstackReaderUrl, normalizePageUrl } from "@cn/core/pageUrls";
import {
  readSubstackPublicationFromPage,
  resolveProfileCreatorTarget,
  substackCreatorTarget,
  substackProfileHandle,
  substackTargetFromPublication,
} from "./creatorTarget";
import type { MenuSite, MenuSubject } from "./menuRows";
import { isSubstackPostPage } from "./pageShape";

// Substack's three-dot menus: the one on a post in the substack.com feed, the
// one in an open post's action bar, and the one at the top of a post opened as
// an overlay in substack.com's reader. Every selector they depend on lives
// here. Substack builds its menus with Base UI, a React component library. Its
// menu button names its open menu in `aria-controls`, and the menu names its
// button in `aria-labelledby`. Substack used Radix before, which sets the same
// attributes. Tidy Web's src/content/substack-menu.ts finds the
// menu the same way.
//
// Which post a menu is about follows one rule. From the menu button we walk up
// to the nearest element that holds one item of the page, such as a post or a
// Note in the feed or a comment. A post item names its post through the one
// post link inside it. Any other item gets no rows. A button outside every item
// belongs to the page itself. It is about the open post when the page is a
// post, and about the author when the page is a profile, which gets only the
// author's row. Elsewhere it gets no rows.

const TRIGGER_SELECTOR = 'button[aria-haspopup="menu"]:is(:has(svg.lucide-ellipsis), [class*="moreButton-"])';
// Comments have the same three-dot menu, and we do not check comments.
const COMMENT_SELECTOR = '[class*="comment-menu"]';
// substack.com itself hosts the reader, never a publication's posts.
const READER_HOST = /^(www\.)?substack\.com$/;
// The elements that hold one item of a page. The feed tags each item with an
// entity key, a post card on a publication's pages is a .post-preview, an inbox
// row is a .reader2-post-container, and a comment is a .comment.
const ITEM_SELECTOR = "[data-entity-key], .post-preview, .reader2-post-container, .comment";
// A feed item's entity key starts with "p-" for a post. Notes start with "c-"
// and video clips with "m-".
const POST_ENTITY_KEY_PREFIX = "p-";
const POST_CARD_SELECTOR = ".post-preview, .reader2-post-container";
// A post's own address ends in /p/<slug>, and the address of one of its
// comments continues with /comment/<id>.
const COMMENT_PATH = /\/comment\//;
// The item's author is the profile behind their avatar, which Substack tags
// with this parameter. The first profile link can be someone who only
// restacked the post.
const AUTHOR_LINK_SELECTOR = 'a[href*="utm_source=substack-feed-item"]';

/** The open post. On substack.com's reader the address is not the post's own,
 *  so the background resolves it when the check starts, and the reader view
 *  gets no creator row. */
function openPostSubject(): MenuSubject | null {
  if (!isSubstackPostPage(location.href) && !isSubstackReaderUrl(location.href)) return null;
  return {
    page: { url: normalizePageUrl(location.href, document), title: document.title, noun: "post", current: true },
    creator: async () =>
      substackCreatorTarget(location.href) ?? substackTargetFromPublication(readSubstackPublicationFromPage()),
  };
}

/** The post's title inside its card. The card is one link around the
 *  publication's name, which is a link of its own, and the title after it. */
function postTitle(post: HTMLAnchorElement): string {
  const walker = document.createTreeWalker(post, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text && node.parentElement?.closest("a") === post) return text;
  }
  return "";
}

function isPostItem(item: Element): boolean {
  const entityKey = item.getAttribute("data-entity-key");
  if (entityKey !== null) return entityKey.startsWith(POST_ENTITY_KEY_PREFIX);
  return item.matches(POST_CARD_SELECTOR);
}

/** The links inside an item that lead to a post on its publication's site,
 *  one per post. A card often links its post twice, through the picture and
 *  through the title. */
function distinctPostLinks(item: Element): HTMLAnchorElement[] {
  const byPage = new Map<string, HTMLAnchorElement>();
  for (const link of item.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const { hostname, pathname } = new URL(link.href);
    if (READER_HOST.test(hostname) || !isSubstackPostPage(link.href) || COMMENT_PATH.test(pathname)) continue;
    const pageUrl = normalizePageUrl(link.href);
    if (!byPage.has(pageUrl)) byPage.set(pageUrl, link);
  }
  return [...byPage.values()];
}

/** A post item links to its own address on the publication's site. An item
 *  that links two different posts, such as a post quoting another, gets no
 *  rows, because we cannot tell which one the menu is about. A publication on
 *  its own domain is named by the author's profile link instead, which
 *  Substack's profile API turns into the publication. */
function postItemSubject(item: Element): MenuSubject | null {
  const posts = distinctPostLinks(item);
  if (posts.length !== 1) return null;
  const post = posts[0]!;
  const authorLink = item.querySelector<HTMLAnchorElement>(AUTHOR_LINK_SELECTOR);
  const handle = authorLink ? substackProfileHandle(authorLink.href) : null;
  const pageUrl = normalizePageUrl(post.href);
  return {
    page: { url: pageUrl, title: postTitle(post), noun: "post", current: false },
    creator: async () => substackCreatorTarget(pageUrl) ?? (handle ? resolveProfileCreatorTarget(handle) : null),
  };
}

/** A profile page such as substack.com/@thezvi. Its own menu offers the
 *  author's new posts, through the publication Substack's profile API names. */
function profileSubject(): MenuSubject | null {
  const handle = substackProfileHandle(location.href);
  if (!handle) return null;
  return { page: null, creator: () => resolveProfileCreatorTarget(handle) };
}

export const substackMenuSite: MenuSite = {
  name: "substack",
  triggerFor(target) {
    const trigger = target.closest<HTMLElement>(TRIGGER_SELECTOR);
    return trigger && !trigger.closest(COMMENT_SELECTOR) ? trigger : null;
  },
  subjectFor(trigger) {
    const item = trigger.closest(ITEM_SELECTOR);
    if (!item) return openPostSubject() ?? profileSubject();
    return isPostItem(item) ? postItemSubject(item) : null;
  },
  menuFor(trigger) {
    const id = trigger.getAttribute("aria-controls");
    const controlled = id ? document.getElementById(id) : null;
    if (controlled?.getAttribute("role") === "menu") return controlled;
    // When the button does not name its menu, the menu may still name the
    // button. Tidy Web reads both for that reason. The attribute holds a list
    // of ids separated by spaces.
    return (
      [...document.querySelectorAll<HTMLElement>('[role="menu"][aria-labelledby]')].find(
        (menu) => !!trigger.id && menu.getAttribute("aria-labelledby")!.split(/\s+/).includes(trigger.id),
      ) ?? null
    );
  },
  // Inside the column that holds Substack's own rows, so our rows take the
  // menu's padding and width.
  mount(group, menu) {
    const native = menu.querySelector('[role="menuitem"]');
    (native?.parentElement ?? menu).prepend(group);
  },
  // Substack's label class sets the menu's own font size and colour.
  dress(_row, _icon, label, native) {
    const nativeLabel = native.lastElementChild;
    if (nativeLabel) label.className = nativeLabel.className;
  },
};
