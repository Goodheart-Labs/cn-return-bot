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

// Substack's three-dot menus: the one on a post in the substack.com feed, and
// the one in an open post's action bar. Every selector they depend on lives
// here. Substack builds its menus with Radix, a React component library whose
// menu button names its open menu in `aria-controls`. Tidy Web's
// src/content/substack-menu.ts finds the menu the same way.

const TRIGGER_SELECTOR = 'button[aria-haspopup="menu"]:is(:has(svg.lucide-ellipsis), [class*="moreButton-"])';
// Comments have the same three-dot menu, and we do not check comments.
const COMMENT_SELECTOR = '[class*="comment-menu"]';
// substack.com itself hosts the reader, never a publication's posts.
const READER_HOST = /^(www\.)?substack\.com$/;
// The open post's action bar sits above and below the post.
const POST_ACTION_BAR_TRIGGER_CLASS = "post-ufi-button";
const FEED_ITEM_SELECTOR = '[role="article"]';
// A feed item that links to a Note is a Note, or quotes a post inside one.
const NOTE_LINK_SELECTOR = 'a[href*="/note/"]';
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
    pageUrl: normalizePageUrl(location.href, document),
    title: document.title,
    noun: "post",
    currentPage: true,
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

/** A post in the feed links to its own address on the publication's site. A
 *  publication on its own domain is named by the author's profile link
 *  instead, which Substack's profile API turns into the publication. */
function feedPostSubject(item: Element): MenuSubject | null {
  if (item.querySelector(NOTE_LINK_SELECTOR)) return null;
  const post = [...item.querySelectorAll<HTMLAnchorElement>("a[href]")].find(
    (link) => !READER_HOST.test(link.hostname) && isSubstackPostPage(link.href),
  );
  if (!post) return null;
  const authorLink = item.querySelector<HTMLAnchorElement>(AUTHOR_LINK_SELECTOR);
  const handle = authorLink ? substackProfileHandle(authorLink.href) : null;
  const pageUrl = normalizePageUrl(post.href);
  return {
    pageUrl,
    title: postTitle(post),
    noun: "post",
    currentPage: false,
    creator: async () => substackCreatorTarget(pageUrl) ?? (handle ? resolveProfileCreatorTarget(handle) : null),
  };
}

export const substackMenuSite: MenuSite = {
  name: "substack",
  triggerFor(target) {
    const trigger = target.closest<HTMLElement>(TRIGGER_SELECTOR);
    return trigger && !trigger.closest(COMMENT_SELECTOR) ? trigger : null;
  },
  subjectFor(trigger) {
    if (trigger.classList.contains(POST_ACTION_BAR_TRIGGER_CLASS)) return openPostSubject();
    const item = trigger.closest(FEED_ITEM_SELECTOR);
    return item ? feedPostSubject(item) : null;
  },
  menuFor(trigger) {
    const id = trigger.getAttribute("aria-controls");
    const menu = id ? document.getElementById(id) : null;
    return menu?.getAttribute("role") === "menu" ? menu : null;
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
