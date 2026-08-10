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
import { track } from "../../everything-shared/analytics";

const HIGHLIGHT_NAME = "common-note";
const REANCHOR_DEBOUNCE_MS = 600;

/** The element holding the readable text: Substack's article body when
 *  present, else the page's main/article, else body. */
function findContainer(): Element {
  return (
    document.querySelector("article .available-content") ??
    document.querySelector("article") ??
    document.querySelector("main") ??
    document.body
  );
}

/** Anchor every claim group to a Range. Candidates in reliability order:
 *  healed live wording, captured quote, wider paragraph. */
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
const HIGHLIGHT_TINT_DARK = "rgba(96, 165, 250, 0.25)"; // blue-400, stronger: reads on dark

/** The ::highlight rule must live in the DOCUMENT (the highlighted text is
 *  light DOM). Idempotent: one style element by id, tint updated in place on
 *  theme flips. */
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

/** Tint the anchored passages via the CSS Custom Highlight API — no host-DOM
 *  mutation, so host-page frameworks never notice us. */
function applyHighlights(ranges: Range[]) {
  const highlights = (CSS as any).highlights;
  if (!highlights) return; // old Firefox ESR: badges only, no tint
  if (ranges.length === 0) highlights.delete(HIGHLIGHT_NAME);
  else highlights.set(HIGHLIGHT_NAME, new (globalThis as any).Highlight(...ranges));
}

/** Resolve `href` to an ingested item, anchor its claims, mount the overlay.
 *  Returns a teardown for the mounted overlay, or null when the page isn't
 *  ingested. */
async function mountForUrl(ctx: ContentScriptContext, href: string, onCoverageChanged: () => void): Promise<(() => void) | null> {
  const readerCanonical = await resolveReaderCanonical(href);
  const pageUrl = readerCanonical ? normalizePageUrl(readerCanonical) : normalizePageUrl(href, document);
  // Decide "is this page ours?" against the locally cached coverage list
  // BEFORE any backend call — ordinary browsing on covered sites must never
  // reach our server. A missing list (pre-first-sync) falls through to the
  // live lookup rather than hiding notes.
  const covered = await getCoveredPageUrls();
  if (covered && !pageIsCovered(pageUrl, covered)) {
    console.info(`[common-notes] ${pageUrl} → not in the covered list (no backend lookup)`);
    return mountWriteAnywhere(ctx, pageUrl, onCoverageChanged);
  }
  const item = await fetchItemForUrl(pageUrl);
  console.info(`[common-notes] ${pageUrl} → ${item ? `item "${item.title ?? item.id}"` : "no ingested item"}`);
  if (!item) return mountWriteAnywhere(ctx, pageUrl, onCoverageChanged);
  // Mount even with zero notes: the write-from-selection flow works on any
  // ingested page, and its first note appears via refresh().
  let groups = await fetchClaimGroups(item.id);
  // The extension's top of funnel: notes were actually displayed to a reader.
  // Once per page by construction — mountForUrl runs once per URL.
  if (groups.length > 0) {
    track("notes_shown", {
      surface: "inline",
      item_id: item.id,
      claim_count: groups.length,
      note_count: groups.reduce((n, g) => n + g.notes.length, 0),
    });
  }

  let reactRoot: Root | null = null;
  let themeRoot: HTMLElement | null = null;

  // Annotation layer: badges/popovers portal into this host, mounted INSIDE
  // the article container so they move natively with the text under ANY
  // scroll container (the reader scrolls an inner div, not the document — a
  // body-anchored overlay there must chase the text with per-frame JS, always
  // a frame behind the composited scroll). The host must be IN-FLOW
  // (:host(common-notes-inline) is position:relative, 0×0): an absolute host
  // only scrolls with its CONTAINING BLOCK's scrollers, which may sit outside
  // the inner scroller. The function anchor is re-resolved on every mount(),
  // so a re-append after an SPA article swap lands in the new article.
  const inlineUi = await createShadowRootUi(ctx, {
    name: "common-notes-inline",
    position: "inline",
    anchor: () => findContainer(),
    onMount(container) {
      // Idempotent — mount() re-runs this on SPA re-append.
      container.style.position = "relative";
      container.classList.add("cn-theme-root");
    },
  });
  inlineUi.mount();

  // One sync point for all theme surfaces: the .dark class in both shadow
  // roots (activates every dark: variant) and the ::highlight tint in the
  // host document.
  const syncTheme = () => {
    const dark = isPageDark(findContainer());
    themeRoot?.classList.toggle("dark", dark);
    inlineUi.uiContainer.classList.toggle("dark", dark);
    if ((CSS as any).highlights) ensureHighlightStyle(dark);
  };

  // Re-query the container every render: SPA navigations can replace the
  // article element after we mount, and anchoring against a detached node
  // finds nothing forever.
  const render = () => {
    syncTheme(); // piggybacks on the debounced re-anchor observer: catches
    // theme repaints that arrive as DOM swaps rather than attribute flips
    // The SPA swapped the article node out from under us (same URL): re-append
    // the annotation host into the new container before anchoring against it.
    // Can't loop — the append fires the debounced observer once, then settles.
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
  // Popup tickbox flips re-fetch through the new filters, live.
  const stopFilters = onNoteFiltersChanged(() => void refresh());

  const ui = await createShadowRootUi(ctx, {
    name: "common-notes-ui",
    position: "inline",
    anchor: "body",
    onMount(uiContainer, _shadow, _shadowHost) {
      // Host geometry lives in assets/tailwind.css (`:host(common-notes-ui)`)
      // — inline styles set here are dead on arrival, WXT's shadow reset
      // (`:host{all:initial !important}`) overrides them.
      uiContainer.style.position = "relative";
      // Theme root: base font/color + the `.dark` toggle live on this class.
      // Tailwind's class strategy compiles dark:x to `x:is(.dark *)`, which
      // excludes the .dark element itself — never put dark: classes here.
      uiContainer.classList.add("cn-theme-root");
      themeRoot = uiContainer;
      reactRoot = createRoot(uiContainer);
      render(); // syncTheme runs synchronously inside — no light-flash
      return reactRoot;
    },
    onRemove(root) {
      root?.unmount();
      (CSS as any).highlights?.delete(HIGHLIGHT_NAME);
    },
  });
  ui.mount();

  // Theme flips arrive as attribute changes on html/body (YouTube's html[dark],
  // class-based togglers like Substack's reader) — the subtree observer below
  // watches childList/characterData only, so they need their own watcher.
  const stopTheme = observePageTheme(syncTheme, findContainer);

  // Host pages hydrate/lazy-load/swap the article; re-anchor after the dust
  // settles. Observe documentElement, not body — SPAs can replace the body
  // node, which would orphan the observer. Safe from self-triggering: our UI
  // renders into a shadow root, which light-DOM observers don't see into.
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

/** Entry for both the Substack/static and the opt-in generic content scripts.
 *  Substack and other Substack-like readers are SPAs: the content script is
 *  injected once, but in-app navigation swaps the article via pushState with no
 *  reload. Re-resolve the item + re-anchor on every URL change so notes appear
 *  on posts reached by clicking through, not just on hard loads. */
export async function mountInlineNotes(ctx: ContentScriptContext): Promise<void> {
  let cleanup: (() => void) | null = null;
  let seq = 0;
  const remount = async (href: string) => {
    const mine = ++seq;
    cleanup?.();
    cleanup = null;
    // Writing the first note on an uncovered page makes it covered: the
    // write-anywhere mount reports back and the full notes flow takes over
    // in place — the fresh note shows without a reload.
    const teardown = await mountForUrl(ctx, href, () => void remount(location.href));
    // A newer navigation superseded this one mid-resolve: drop the stale mount.
    if (mine !== seq) return teardown?.();
    cleanup = teardown;
  };
  await remount(location.href);
  // On Navigation-API browsers this event fires BEFORE the navigation commits
  // — location.href may still be the PREVIOUS page — so resolve the item from
  // the event's destination URL, never from location.
  ctx.addEventListener(window, "wxt:locationchange", (event) => void remount(String(event.newUrl)));
  ctx.onInvalidated(() => cleanup?.());
}
