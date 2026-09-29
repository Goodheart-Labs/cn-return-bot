import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import type { NoteSet } from "@cn/features/notes/noteSet";
import { queryClient } from "@cn/features/query/queryClient";
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { fetchItemForUrl } from "@cn/core/items";
import { normalizePageUrl } from "@cn/core/pageUrls";
import { resolveReaderCanonical } from "./readerCanonical";
import { anchorGroups } from "./anchorGroups";
import { applyHighlights, ensureHighlightStyle, hasHighlightApi, HIGHLIGHT_NAME } from "./passageHighlights";
import { claimGroups, itemNoteSetQuery, noteCounts } from "./claimGroups";
import { mountCoverageBadges } from "./coverageBadges";
import { getCoveredPageUrls, pageIsCovered } from "./coveredPages";
import { recordPageVisit } from "./linkVisits";
import { mountWriteAnywhere } from "./mountWriteAnywhere";
import { REQUEST_NOTES_CHANGED_EVENT } from "./requestLive";
import { listenForRequestInfo } from "./requestInfo";
import { getNoteDisplay, getSettings, onNoteDisplayChanged, onSettingsChanged, type NoteStyle } from "./settings";
import { isPageDark, observePageTheme } from "./pageTheme";
import { InlineNotesApp } from "../components/InlineNotes";
import { PillPaletteFromSettings } from "../components/PillPaletteFromSettings";
import { track } from "@cn/core/analytics";

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
    recordPageVisit(pageUrl, null);
    return mountWriteAnywhere(ctx, pageUrl, onCoverageChanged);
  }
  // A failed lookup mounts nothing. Treating an outage as an unchecked page
  // would tell the reader we never checked a page we did, and offer to check
  // it again.
  let item;
  try {
    item = await fetchItemForUrl(pageUrl);
  } catch (err) {
    console.warn(`[common-notes] ${pageUrl} → item lookup failed, mounting nothing:`, err);
    return null;
  }
  console.info(`[common-notes] ${pageUrl} → ${item ? `item "${item.title ?? item.id}"` : "no ingested item"}`);
  if (!item) {
    recordPageVisit(pageUrl, null);
    return mountWriteAnywhere(ctx, pageUrl, onCoverageChanged);
  }
  recordPageVisit(pageUrl, item);
  // We mount even when the item has no notes yet. Writing a note from a selection
  // works on any ingested page, and the cache observer below brings the new
  // note in.
  const notesQuery = itemNoteSetQuery(item.id);
  // The same rule as the lookup: a failed notes fetch mounts nothing.
  let noteSet: NoteSet;
  try {
    noteSet = await queryClient.fetchQuery(notesQuery);
  } catch (err) {
    console.warn(`[common-notes] ${pageUrl} → notes fetch failed, mounting nothing:`, err);
    return null;
  }
  let display = await getNoteDisplay();
  // The extension's top of funnel: notes were actually displayed to a reader.
  // Once per page by construction — mountForUrl runs once per URL.
  const visibleNotes = noteCounts(noteSet.notes.values(), display).visible;
  if (visibleNotes > 0) {
    track("notes_shown", {
      surface: "inline",
      item_id: item.id,
      claim_count: claimGroups(noteSet, display).length,
      note_count: visibleNotes,
    });
  }

  // The note style is read once here and kept fresh by the settings listener
  // below, so flipping it in the settings applies without a reload.
  let noteStyle: NoteStyle = (await getSettings()).noteStyle;

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
    if (hasHighlightApi()) ensureHighlightStyle(dark);
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
    const anchored = anchorGroups(container, claimGroups(noteSet, display));
    // A faint claim gets only its pale marker, so its passage stays untinted.
    applyHighlights(anchored.filter((g) => g.display !== "faint").map((g) => g.range));
    reactRoot?.render(
      <QueryClientProvider client={queryClient}>
        <PillPaletteFromSettings>
          <InlineNotesApp groups={anchored} item={item} container={container} inlineContainer={inlineUi.uiContainer} noteStyle={noteStyle} />
        </PillPaletteFromSettings>
      </QueryClientProvider>,
    );
  };

  // A vote, a new note or a deletion changes the page's cached notes. The
  // observer hears every such change, and the markers follow it on the
  // spot.
  const stopNotes = new QueryObserver(queryClient, notesQuery).subscribe(({ data }) => {
    if (!data || data === noteSet) return;
    noteSet = data;
    render();
  });
  // A changed display choice applies straight away, whether it was made in
  // the settings or with the link on an unhelpful note.
  const stopDisplay = onNoteDisplayChanged(() => {
    void getNoteDisplay().then((next) => {
      display = next;
      render();
    });
  });
  // A note-style flip in the settings re-renders the markers in place.
  const stopSettings = onSettingsChanged(() => {
    void getSettings().then((settings) => {
      if (settings.noteStyle === noteStyle) return;
      noteStyle = settings.noteStyle;
      render();
    });
  });

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
      if (hasHighlightApi()) CSS.highlights.delete(HIGHLIGHT_NAME);
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
    stopNotes();
    stopDisplay();
    stopSettings();
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
  // The background answers a needless request, for example on an already
  // checked page, with an explanation card through this listener.
  listenForRequestInfo(ctx);
  // Listing badges live independently of the per-URL note mounts below. They
  // mark noted posts in whatever listing this site shows, such as a Substack
  // front page, and their own observer follows navigations and lazy loading.
  const stopBadges = await mountCoverageBadges(ctx);
  ctx.onInvalidated(() => stopBadges?.());
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
  // A live request writes its notes while the reader is on the page, and a page
  // that was uncovered at load has no notes UI to show them. The live card's
  // watcher announces every new note, and the remount here is what turns it
  // into a highlight on the spot.
  ctx.addEventListener(window, REQUEST_NOTES_CHANGED_EVENT, () => void remount(location.href));
  // In browsers with the Navigation API this event fires before the navigation
  // commits. At that moment location.href can still point at the previous page. So
  // we resolve the item from the event's destination URL and never from location.
  ctx.addEventListener(window, "wxt:locationchange", (event) => void remount(String(event.newUrl)));
  ctx.onInvalidated(() => cleanup?.());
}
