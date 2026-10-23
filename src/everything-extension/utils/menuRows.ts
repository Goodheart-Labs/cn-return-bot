import { browser } from "#imports";
import type { ContentScriptContext } from "#imports";
import { requestCreatorPriority } from "@cn/core/creators";
import { submitNoteRequest } from "@cn/core/noteRequests";
import { NOTE_STACK_GLYPH_PATH } from "@cn/ui/icons";
import { getWholePageCheckedUrls, pageIsCovered } from "./coveredPages";
import { priorityButtonLabel, priorityDoneLabel, type CreatorTarget } from "./creatorTarget";
import { rememberPressed, unlessPrioritized } from "./prioritizedCreators";
import { showInfoCard } from "./requestInfo";
import { addRequestedPage, getRequestedPages } from "./settings";

// Our rows inside a site's own three-dot menu, such as the menu on a YouTube
// video or on a Substack post. The rows offer "Check this video" and "Check
// this youtuber's new videos" right where the reader already looks for
// actions on that item. The approach is copied from Tidy Web, a Happy Squid
// extension that puts its "Block channel" rows into the same menus
// (Happy-Squid-Blocker/tidyweb, src/content/source-menu.ts and
// menu-actions.ts).
//
// The rows live in the site's own DOM, inside its menu, and not in a shadow
// root of ours. That is the only way to sit between the site's own rows. A
// click on a menu button selects the item the menu belongs to. When the site's
// menu then appears, we put our group of rows at its top. The site's next
// rendering may drop them, so we watch the menu and put them back.

/** The page a three-dot menu belongs to. */
export interface MenuSubject {
  pageUrl: string;
  title: string;
  noun: "video" | "post";
  /** True when the menu belongs to the page the reader has open, such as the
   *  menu under the playing video. Such a check goes through the background,
   *  which reads the page's text and follows the check with the progress
   *  card. */
  currentPage: boolean;
  /** The page's creator. On Substack this can need a lookup. */
  creator: () => Promise<CreatorTarget | null>;
}

/** How one site's menus work. Every selector lives in the site's file. */
export interface MenuSite {
  /** Sets the row defaults in the stylesheet below. */
  name: "youtube" | "substack";
  /** The menu button a click landed on, or null. */
  triggerFor(target: Element): HTMLElement | null;
  /** The video or post the menu button belongs to, or null when it belongs to
   *  something we cannot check, such as a Substack Note or a YouTube Short. */
  subjectFor(trigger: HTMLElement): MenuSubject | null;
  /** The open menu that the button opened, or null while it is not open. */
  menuFor(trigger: HTMLElement): HTMLElement | null;
  /** Puts our group into the menu, above the site's own rows. */
  mount(group: HTMLElement, menu: HTMLElement): void;
  /** Called after our rows were added, for a menu that has to be told its
   *  size changed. */
  refit?(menu: HTMLElement): void;
  /** Gives our row the site's own look. The default copies only the
   *  alignment of the site's icons and labels. */
  dress?(row: HTMLElement, icon: HTMLElement, label: HTMLElement, native: HTMLElement): void;
}

interface MenuRow {
  label: string;
  /** Runs the row's action and returns the confirmation to show, or null
   *  when the background shows its own. */
  run: () => Promise<string | null>;
}

const GROUP_ATTRIBUTE = "data-cn-menu-rows";
const GROUP_SELECTOR = `[${GROUP_ATTRIBUTE}]`;
// A site's own row, the one our rows copy their alignment from.
const NATIVE_ROW_SELECTOR = '[role="menuitem"]';
// A click on a menu button that opens no menu within this time leaves
// nothing behind.
const MENU_OPEN_WAIT_MS = 1500;
const FAILURE_HEADLINE = "Could not start the check. Please try again.";

/** The rows for one page. A row is left out when it would ask for work we
 *  already do: a page we read in full, a page the reader already asked for,
 *  or any page of a creator whose week of checking is running. These are the
 *  popup's rules. */
async function rowsFor(subject: MenuSubject): Promise<MenuRow[]> {
  const [checked, requested, creator] = await Promise.all([
    getWholePageCheckedUrls(),
    getRequestedPages(),
    subject.creator().catch(() => null),
  ]);
  const pressable = await unlessPrioritized(creator);
  const creatorPrioritized = !!creator && !pressable;
  const pageHandled =
    creatorPrioritized ||
    pageIsCovered(subject.pageUrl, checked ?? []) ||
    pageIsCovered(subject.pageUrl, requested);
  const rows: MenuRow[] = [];
  if (!pageHandled) rows.push({ label: `Check this ${subject.noun}`, run: () => checkPage(subject, creator) });
  if (pressable) rows.push({ label: priorityButtonLabel(pressable), run: () => pressCreator(pressable) });
  return rows;
}

/** The background owns the check of the open page. Another page gets a
 *  request without its text, which the pipeline then fetches itself. */
async function checkPage(subject: MenuSubject, creator: CreatorTarget | null): Promise<string | null> {
  if (subject.currentPage) {
    // The background runs the right-click menu's "Check this page with
    // Common Notes" for the tab the message came from.
    await browser.runtime.sendMessage({ type: "cn-check-open-page" });
    return null;
  }
  await submitNoteRequest({
    pageUrl: subject.pageUrl,
    pageTitle: subject.title,
    selection: null,
    creatorFeedUrl: creator?.feedUrl ?? null,
  });
  // This is only a local reminder. The request itself is already saved.
  await addRequestedPage(subject.pageUrl).catch(() => {});
  return `Checking this ${subject.noun} now.`;
}

async function pressCreator(target: CreatorTarget): Promise<string> {
  await requestCreatorPriority({ feedUrl: target.feedUrl });
  await rememberPressed(target).catch(() => {});
  return priorityDoneLabel(target);
}

/** Adds our rows to the site's three-dot menus for as long as the content
 *  script runs. */
export function installMenuRows(ctx: ContentScriptContext, site: MenuSite): void {
  ensureMenuRowStyle();
  type Selection = {
    trigger: HTMLElement;
    subject: MenuSubject;
    rows: Promise<MenuRow[]>;
    menu?: HTMLElement;
    group?: HTMLElement;
  };
  let selection: Selection | null = null;
  let queued = false;
  let openingTimer: ReturnType<typeof setTimeout> | undefined;

  const observer = new MutationObserver(() => schedule());
  function clear() {
    observer.disconnect();
    clearTimeout(openingTimer);
    selection?.group?.remove();
    selection = null;
  }

  /** Closes the site's menu the way a reader would, with the Escape key, sent
   *  from one of its own rows so the site's key handler hears it. */
  function closeMenu(selected: Selection) {
    const native = [...(selected.menu?.querySelectorAll<HTMLElement>(NATIVE_ROW_SELECTOR) ?? [])].find((row) => !row.closest(GROUP_SELECTOR));
    for (const type of ["keydown", "keyup"]) {
      (native ?? selected.menu)?.dispatchEvent(
        new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true, composed: true }),
      );
    }
    clear();
  }

  function buildGroup(selected: Selection, rows: MenuRow[], native: HTMLElement): HTMLElement {
    const group = document.createElement("div");
    group.setAttribute(GROUP_ATTRIBUTE, "");
    group.dataset.cnSite = site.name;
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Common Notes");
    for (const row of rows) {
      const { element, icon, label } = createRowElement(row.label);
      site.dress?.(element, icon, label, native);
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (selection !== selected || group.getAttribute("aria-busy") === "true") return;
        group.setAttribute("aria-busy", "true");
        group.querySelectorAll("button").forEach((button) => (button.disabled = true));
        let headline: string | null;
        try {
          headline = await row.run();
        } catch (err) {
          console.warn("[common-notes] menu row failed:", err);
          headline = FAILURE_HEADLINE;
        }
        if (selection === selected) closeMenu(selected);
        if (headline) showInfoCard(ctx, headline);
      });
      group.append(element);
    }
    return group;
  }

  async function sync() {
    queued = false;
    const selected = selection;
    if (!selected || selected.group?.isConnected) return;
    const menu = site.menuFor(selected.trigger);
    if (!menu || !isShown(menu)) return;
    const native = [...menu.querySelectorAll<HTMLElement>(NATIVE_ROW_SELECTOR)].find((row) => !row.closest(GROUP_SELECTOR) && isShown(row));
    if (!native) return;
    const rows = await selected.rows;
    if (selection !== selected || selected.group?.isConnected) return;
    if (!rows.length) return clear();
    clearTimeout(openingTimer);
    selected.menu = menu;
    selected.group ??= buildGroup(selected, rows, native);
    site.mount(selected.group, menu);
    alignWithNativeRow(selected.group, native);
    site.refit?.(menu);
    // From here on only the menu itself matters. Watching it puts our group
    // back when the site renders the menu again.
    observer.disconnect();
    observer.observe(menu, { childList: true, subtree: true });
  }
  function schedule() {
    if (!selection || queued) return;
    queued = true;
    queueMicrotask(() => void sync());
  }

  function select(event: Event) {
    const target = asElement(event.composedPath()[0]);
    if (!target || target.closest(GROUP_SELECTOR)) return;
    // A click on one of the site's own rows leaves our group alone. The site
    // closes its menu, and the next menu button click starts afresh.
    if (selection?.menu?.contains(target)) return;
    const trigger = site.triggerFor(target);
    if (trigger && trigger === selection?.trigger) return schedule();
    clear();
    if (!trigger) return;
    const subject = site.subjectFor(trigger);
    if (!subject) return;
    selection = { trigger, subject, rows: rowsFor(subject) };
    // The menu does not exist yet, so we watch the page for it until it
    // appears or the wait runs out.
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "aria-hidden", "aria-expanded", "data-state"] });
    openingTimer = setTimeout(() => {
      if (!selection?.group) clear();
    }, MENU_OPEN_WAIT_MS);
    schedule();
  }

  /** The site's menu moves the focus between its own rows with the arrow keys
   *  and does not know about ours. While our rows are in the menu, we move the
   *  focus ourselves, through the site's rows and ours alike. Enter and Space
   *  on our row press it, before the site's menu treats them as a choice of
   *  its own row. */
  function keydown(event: KeyboardEvent) {
    const selected = selection;
    const target = asElement(event.composedPath()[0]);
    if (event.key === "Escape") {
      if (selected?.group?.contains(target)) closeMenu(selected);
      else clear();
      return;
    }
    if (!selected?.menu || !selected.group || !target || !selected.menu.contains(target)) return;
    if ((event.key === "Enter" || event.key === " ") && selected.group.contains(target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) target.closest("button")?.click();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const items = focusableRows(selected.menu);
    if (!items.length) return;
    const index = items.findIndex((item) => item.contains(target));
    const next =
      event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    event.preventDefault();
    event.stopImmediatePropagation();
    items[next]!.focus();
  }

  ctx.addEventListener(document, "pointerdown", select, { capture: true });
  ctx.addEventListener(document, "click", select, { capture: true });
  ctx.addEventListener(document, "keydown", keydown, { capture: true });
  ctx.addEventListener(document, "contextmenu", clear, { capture: true });
  ctx.addEventListener(window, "popstate", clear);
  // YouTube is a single-page app and announces its own navigations.
  ctx.addEventListener(window, "yt-navigate-start" as keyof WindowEventMap, clear);
  ctx.onInvalidated(clear);
}

/** A node from an event path, as an element. Firefox hands a content script
 *  the page's nodes through wrappers, so we test the node type rather than use
 *  instanceof. */
function asElement(node: EventTarget | undefined): Element | null {
  return node && (node as Node).nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
}

function isShown(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

/** Every row in the menu that can take the focus, ours included, in screen
 *  order. YouTube nests one menu item inside another, so each row is reduced
 *  to the element that actually takes the focus, and the doubles drop out. */
function focusableRows(menu: HTMLElement): HTMLElement[] {
  const focusable = (item: HTMLElement) =>
    item.matches("button, a[href], [tabindex]") ? item : (item.querySelector<HTMLElement>("button, a[href], [tabindex]") ?? item);
  return [...new Set([...menu.querySelectorAll<HTMLElement>(NATIVE_ROW_SELECTOR)].map(focusable))].filter(
    (item) => !item.closest(':disabled, [aria-disabled="true"]') && isShown(item),
  );
}

const SVG_NS = "http://www.w3.org/2000/svg";

function createRowElement(text: string) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "cn-menu-row";
  element.setAttribute("role", "menuitem");
  element.title = "Common Notes";
  const icon = document.createElement("span");
  icon.setAttribute("data-cn-menu-icon", "");
  icon.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", NOTE_STACK_GLYPH_PATH);
  path.setAttribute("fill-rule", "evenodd");
  svg.append(path);
  icon.append(svg);
  const label = document.createElement("span");
  label.setAttribute("data-cn-menu-label", "");
  label.textContent = text;
  element.append(icon, label);
  return { element, icon, label };
}

/** Lines our icon and label up with the site's own row. We measure where the
 *  site's icon and the start of its label sit inside its row, and hand those
 *  distances to our row's layout as CSS variables. Measuring keeps the rows
 *  aligned however the site sizes its menu. Copied from Tidy Web's
 *  alignMenuActions. */
function alignWithNativeRow(group: HTMLElement, native: HTMLElement) {
  const row = group.querySelector<HTMLElement>(".cn-menu-row");
  if (!row) return;
  const bounds = row.getBoundingClientRect();
  if (!bounds.width || !row.offsetWidth) return;
  const label = firstTextRect(native);
  if (!label) return;
  const rtl = getComputedStyle(native).direction === "rtl";
  const icon = [...native.querySelectorAll("svg, img, yt-icon")]
    .map((element) => element.getBoundingClientRect())
    .find((rect) => rect.width >= 12 && rect.width <= 48 && rect.height > 0 && (rtl ? rect.left >= label.right - 1 : rect.right <= label.left + 1));
  group.style.direction = rtl ? "rtl" : "ltr";
  if (!icon) return;
  // A menu that animates open is scaled while we measure.
  const scale = bounds.width / row.offsetWidth;
  const inset = (rtl ? bounds.right - icon.right : icon.left - bounds.left) / scale;
  const gap = (rtl ? icon.left - label.right : label.left - icon.right) / scale;
  if (inset < 0 || gap < 0) return;
  group.style.setProperty("--cn-menu-inset", `${inset}px`);
  group.style.setProperty("--cn-menu-icon-column", `${icon.width / scale}px`);
  group.style.setProperty("--cn-menu-gap", `${gap}px`);
}

/** The box of the first visible text in the row, which is where its label
 *  starts. */
function firstTextRect(native: HTMLElement): DOMRect | undefined {
  const range = document.createRange();
  const walker = document.createTreeWalker(native, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim() || node.parentElement?.closest('svg, [hidden], [aria-hidden="true"]')) continue;
    range.selectNodeContents(node);
    const rect = [...range.getClientRects()].find((r) => r.width && r.height);
    if (rect) return rect;
  }
  return undefined;
}

// The rows sit in the host page's DOM, where Tailwind does not reach, so they
// get a small stylesheet of their own. The colours come from each site's own
// CSS variables, so the rows follow the site's light or dark theme. Copied
// from Tidy Web's content.css.
const MENU_ROW_STYLE_ID = "common-notes-menu-row-style";
const MENU_ROW_CSS = `
[${GROUP_ATTRIBUTE}] {
  --cn-menu-ink: #0f0f0f;
  --cn-menu-hover: rgba(0, 0, 0, 0.05);
  --cn-menu-divider: rgba(0, 0, 0, 0.1);
  padding: 0 0 8px;
  margin: 0 0 8px;
  border-bottom: 1px solid var(--yt-spec-10-percent-layer, var(--cn-menu-divider));
}
html[dark] [${GROUP_ATTRIBUTE}] {
  --cn-menu-ink: #f1f1f1;
  --cn-menu-hover: rgba(255, 255, 255, 0.1);
  --cn-menu-divider: rgba(255, 255, 255, 0.2);
}
.cn-menu-row {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: var(--cn-menu-icon-column, var(--cn-menu-default-icon-column, 24px)) minmax(0, 1fr);
  align-items: center;
  gap: var(--cn-menu-gap, var(--cn-menu-default-gap, 16px));
  width: 100%;
  min-height: 40px;
  padding: 8px var(--cn-menu-default-inset, 16px);
  padding-inline-start: var(--cn-menu-inset, var(--cn-menu-default-inset, 16px));
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--yt-spec-text-primary, var(--cn-menu-ink));
  font: 400 14px/24px Roboto, Arial, sans-serif;
  text-align: start;
  white-space: nowrap;
  cursor: pointer;
}
.cn-menu-row:focus { outline: none; }
.cn-menu-row:hover,
.cn-menu-row:focus-visible {
  background: var(--yt-spec-badge-chip-background, var(--cn-menu-hover));
}
.cn-menu-row:disabled { opacity: 0.55; cursor: wait; }
.cn-menu-row > [data-cn-menu-icon] { display: grid; place-items: center; min-width: 0; }
.cn-menu-row svg { width: 18px; height: 18px; fill: currentColor; }
.cn-menu-row > [data-cn-menu-label] { min-width: 0; margin: 0; padding: 0; }
[${GROUP_ATTRIBUTE}][data-cn-site="substack"] {
  --cn-menu-default-icon-column: 16px;
  --cn-menu-default-gap: 8px;
  --cn-menu-default-inset: 8px;
  border-color: var(--color-detail, #80808040);
  color: var(--color-fg-primary, inherit);
}
[data-cn-site="substack"] .cn-menu-row {
  color: inherit;
  font: inherit;
  border-radius: 4px;
  transition: background-color 120ms ease;
}
[data-cn-site="substack"] .cn-menu-row:hover,
[data-cn-site="substack"] .cn-menu-row:focus-visible {
  background: var(--color-bg-secondary, #80808020);
}
`;

function ensureMenuRowStyle() {
  if (document.getElementById(MENU_ROW_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = MENU_ROW_STYLE_ID;
  style.textContent = MENU_ROW_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}
