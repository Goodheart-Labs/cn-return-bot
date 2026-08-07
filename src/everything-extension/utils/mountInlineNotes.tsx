import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { fetchItemForUrl, normalizePageUrl } from "../../everything-shared/notesQuery";
import { resolveReaderCanonical } from "./readerCanonical";
import { indexContainer, findQuoteRange } from "./anchor";
import { fetchClaimGroups, type ClaimGroup } from "./claimGroups";
import { getCoveredPageUrls, pageIsCovered } from "./coveredPages";
import { mountWriteAnywhere } from "./mountWriteAnywhere";
import { onNoteFiltersChanged } from "./settings";
import { isPageDark, observePageTheme } from "./pageTheme";
import { InlineNotesApp, type AnchoredGroup } from "../components/InlineNotes";

const HIGHLIGHT_NAME = "common-note";
const REANCHOR_DEBOUNCE_MS = 600;

/** Finds the element that holds the page's readable text. On Substack that is the
 *  article body. On any other page we fall back to the article element, then to
 *  main, then to the body. */
function findContainer(): Element {
  return (
    document.querySelector("article .available-content") ??
    document.querySelector("article") ??
    document.querySelector("main") ??
    document.body
  );
}

/** Anchors every claim group to a range of text inside the container. Each claim
 *  offers three quotes and we try them in order of reliability. First the updated
 *  quote, which is how the passage reads on the page today. Then the quote that was
 *  captured when the claim was extracted. Then the wider paragraph around it. */
function anchorGroups(container: Element, groups: ClaimGroup[]): AnchoredGroup[] {
  const index = indexContainer(container);
  const anchored: AnchoredGroup[] = [];
  for (const { claimId, notes, nnn } of groups) {
    const claim = notes[0]!.claim!;
    const candidates = [claim.updated_quote, claim.context_quote, claim.context_paragraph];
    let range: Range | null = null;
    for (const candidate of candidates) {
      if (candidate) range = findQuoteRange(index, candidate);
      if (range) break;
    }
    if (range) anchored.push({ claimId, primary: notes[0]!, alternatives: notes.slice(1), nnn, range });
  }
  console.info(`[common-notes] anchored ${anchored.length}/${groups.length} claims on this page`);
  return anchored;
}

const HIGHLIGHT_TINT_LIGHT = "rgba(59, 130, 246, 0.16)";
const HIGHLIGHT_TINT_DARK = "rgba(96, 165, 250, 0.25)"; // Tailwind's blue-400. It is stronger than the light tint so it reads on a dark page.

/** Makes sure the ::highlight rule exists in the host document. The rule cannot live
 *  in our shadow root, because the text it highlights belongs to the page itself.
 *  Calling this again is safe. It reuses the one style element carrying our id, and
 *  it rewrites the tint in place when the page flips between light and dark. */
function ensureHighlightStyle(dark: boolean) {
  let style = document.getElementById("common-notes-highlight-style") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "common-notes-highlight-style";
    document.head.appendChild(style);
  }
  const text = `::highlight(${HIGHLIGHT_NAME}) { background-color: ${dark ? HIGHLIGHT_TINT_DARK : HIGHLIGHT_TINT_LIGHT}; }`;
  if (style.textContent !== text) style.textContent = text;
}

/** Tints the anchored passages with the CSS Custom Highlight API. That API changes no
 *  nodes in the host page, so the page's own framework never notices us. */
function applyHighlights(ranges: Range[]) {
  const highlights = (CSS as any).highlights;
  if (!highlights) return; // Old Firefox ESR has no Highlight API. Badges still show, only the tint is missing.
  if (ranges.length === 0) highlights.delete(HIGHLIGHT_NAME);
  else highlights.set(HIGHLIGHT_NAME, new (globalThis as any).Highlight(...ranges));
}

/** Resolves `href` to an ingested item, anchors that item's claims and mounts the
 *  overlay. When the page has no ingested item we mount the write-anywhere shell
 *  instead. Either way the returned function tears down whatever was mounted. */
async function mountForUrl(ctx: ContentScriptContext, href: string, onCoverageChanged: () => void): Promise<(() => void) | null> {
  const readerCanonical = await resolveReaderCanonical(href);
  const pageUrl = readerCanonical ? normalizePageUrl(readerCanonical) : normalizePageUrl(href, document);
  // We decide whether this page is one of ours from the locally cached coverage
  // list, and we do it before making any backend call. Ordinary browsing on a
  // covered site must never reach our server. On a fresh install the list has not
  // synced yet. In that case we fall through to the live lookup rather than hide
  // notes.
  const covered = await getCoveredPageUrls();
  if (covered && !pageIsCovered(pageUrl, covered)) {
    console.info(`[common-notes] ${pageUrl} → not in the covered list (no backend lookup)`);
    return mountWriteAnywhere(ctx, pageUrl, onCoverageChanged);
  }
  const item = await fetchItemForUrl(pageUrl);
  console.info(`[common-notes] ${pageUrl} → ${item ? `item "${item.title ?? item.id}"` : "no ingested item"}`);
  if (!item) return mountWriteAnywhere(ctx, pageUrl, onCoverageChanged);
  // We mount even when the item has no notes yet. Writing a note from a selection
  // works on any ingested page, and refresh() brings the new note in.
  let groups = await fetchClaimGroups(item.id);

  let reactRoot: Root | null = null;
  let themeRoot: HTMLElement | null = null;

  // This is the annotation layer. Badges and popovers are portalled into this host.
  // We mount the host inside the article container so that it moves with the text
  // whichever element does the scrolling. Substack's reader scrolls an inner div
  // rather than the document. An overlay anchored to the body would have to chase
  // the text with JavaScript on every frame, and it would always lag one frame
  // behind the browser's own scrolling. The host also has to sit in the normal
  // flow, which is why :host(common-notes-inline) is position:relative and has no
  // size. An absolutely positioned host only scrolls with the scrollers of its
  // containing block, and those can sit outside the inner scroller. The anchor is a
  // function, so it is resolved again on every mount(). That way, if the page swaps
  // the article element out, appending the host again lands it in the new article.
  const inlineUi = await createShadowRootUi(ctx, {
    name: "common-notes-inline",
    position: "inline",
    anchor: () => findContainer(),
    onMount(container) {
      // Running this again is harmless. mount() re-runs it every time we append the
      // host to a new container.
      container.style.position = "relative";
      container.classList.add("cn-theme-root");
    },
  });
  inlineUi.mount();

  // One place that updates every surface the theme touches. Those are the .dark
  // class on both shadow roots, which switches on every Tailwind dark: variant, and
  // the ::highlight tint in the host document.
  const syncTheme = () => {
    const dark = isPageDark(findContainer());
    themeRoot?.classList.toggle("dark", dark);
    inlineUi.uiContainer.classList.toggle("dark", dark);
    if ((CSS as any).highlights) ensureHighlightStyle(dark);
  };

  // We look the container up again on every render. A navigation inside a
  // single-page app can replace the article element after we mounted. Anchoring
  // against a node that is no longer in the document would then find nothing, and it
  // would keep finding nothing.
  const render = () => {
    syncTheme(); // Called here as well, so the debounced re-anchor observer catches
    // theme repaints that arrive as DOM swaps rather than as attribute changes.
    // If the page swapped the article node out from under us without changing the
    // URL, our annotation host is no longer connected. We append it into the new
    // container before anchoring against it. This cannot loop. The append triggers
    // the debounced observer once, and then everything settles.
    if (!inlineUi.shadowHost.isConnected) inlineUi.mount();
    const container = findContainer();
    const anchored = anchorGroups(container, groups);
    applyHighlights(anchored.map((g) => g.range));
    reactRoot?.render(
      <InlineNotesApp
        groups={anchored}
        item={item}
        onPosted={refresh}
        container={container}
        inlineContainer={inlineUi.uiContainer}
      />,
    );
  };

  const refresh = async () => {
    groups = await fetchClaimGroups(item.id);
    render();
  };
  // When the user flips a tickbox in the popup, we re-fetch the notes through the
  // new filters right away.
  const stopFilters = onNoteFiltersChanged(() => void refresh());

  const ui = await createShadowRootUi(ctx, {
    name: "common-notes-ui",
    position: "inline",
    anchor: "body",
    onMount(uiContainer, _shadow, _shadowHost) {
      // The shadow host's own geometry is set in assets/tailwind.css, under
      // `:host(common-notes-ui)`. Do not try to set it inline on the shadow host
      // here. WXT's shadow reset rule `:host{all:initial !important}` overrides
      // anything we would set.
      uiContainer.style.position = "relative";
      // This class is the theme root. It carries the base font and colour, and it is
      // the element the `.dark` class is toggled on. Tailwind's class strategy
      // compiles `dark:x` into `x:is(.dark *)`, which matches descendants of the
      // .dark element but not that element itself. So never put a dark: class here.
      uiContainer.classList.add("cn-theme-root");
      themeRoot = uiContainer;
      reactRoot = createRoot(uiContainer);
      render(); // syncTheme runs synchronously inside render, so the UI never flashes in the wrong theme.
      return reactRoot;
    },
    onRemove(root) {
      root?.unmount();
      (CSS as any).highlights?.delete(HIGHLIGHT_NAME);
    },
  });
  ui.mount();

  // A theme flip usually arrives as an attribute change on html or body. YouTube
  // sets a dark attribute on html, and Substack's reader toggles a class. The
  // observer further down only watches child lists and character data, so attribute
  // changes need a watcher of their own.
  const stopTheme = observePageTheme(syncTheme, findContainer);

  // Host pages hydrate, lazy-load and swap out the article, so we re-anchor once the
  // changes have settled. We observe documentElement rather than body, because a
  // single-page app can replace the body node and that would leave the observer
  // attached to a node nobody uses. Our own UI cannot trigger this observer. It
  // renders inside a shadow root, and an observer on the light DOM does not see
  // into shadow roots.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(render, REANCHOR_DEBOUNCE_MS);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  return () => {
    stopFilters();
    stopTheme();
    observer.disconnect();
    clearTimeout(timer);
    ui.remove();
    inlineUi.remove();
  };
}

/** The entry point for the static Substack content script and for the generic script
 *  that is registered at runtime. Substack and readers like it are single-page apps.
 *  The content script is injected once, but navigating inside the app swaps the
 *  article through pushState without reloading the page. So we resolve the item and
 *  anchor its claims again on every URL change. That way notes also appear on posts
 *  the reader reached by clicking through, not only on a full page load. */
export async function mountInlineNotes(ctx: ContentScriptContext): Promise<void> {
  let cleanup: (() => void) | null = null;
  let seq = 0;
  const remount = async (href: string) => {
    const mine = ++seq;
    cleanup?.();
    cleanup = null;
    // Writing the first note on an uncovered page makes that page covered. The
    // write-anywhere mount calls back here, and the full notes flow takes over on
    // the spot. The new note shows up without a reload.
    const teardown = await mountForUrl(ctx, href, () => void remount(location.href));
    // A newer navigation started while this one was still resolving, so we throw the
    // stale mount away.
    if (mine !== seq) return teardown?.();
    cleanup = teardown;
  };
  await remount(location.href);
  // In browsers with the Navigation API this event fires before the navigation
  // commits. At that moment location.href can still point at the previous page. So
  // we resolve the item from the event's destination URL and never from location.
  ctx.addEventListener(window, "wxt:locationchange", (event) => void remount(String(event.newUrl)));
  ctx.onInvalidated(() => cleanup?.());
}
