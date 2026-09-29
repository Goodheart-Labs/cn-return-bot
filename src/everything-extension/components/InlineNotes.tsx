import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browser } from "#imports";
import { createPortal } from "react-dom";
import type { PageItem } from "@cn/core/items";
import { statusColorClass, statusLabel } from "@cn/features/notes/NoteBox";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import type { ClaimGroup } from "../utils/claimGroups";
import { insideCommonNotesUi, isInertClick } from "../utils/inertClick";
import { setJumpHandler } from "../utils/jumpBus";
import { GroupIcon } from "@cn/ui/icons";
import { ClaimNoteStack, NOTE_POPOVER_WIDTH, type NoteNavigation } from "./ClaimNoteStack";
import { OverlayLoginGate } from "./OverlayLoginGate";
import { EventShield } from "./EventShield";
import { WriteNoteOverlay } from "./WriteNoteOverlay";

/** One claim anchored to the page: the claim's notes with the original first,
 *  its note-not-needed entries, and the stretch of page text it sits on. */
export type AnchoredGroup = ClaimGroup & { range: Range };

const BADGE_SIZE = 20;
const BADGE_GAP = 4; // Pixels between the end of the passage and the badge.
const POPOVER_GAP = 8; // Pixels between the passage and the opened popover.
const VIEWPORT_MARGIN = 8; // The popover stays this many pixels from the edges.

// The margin note style: the marker sits this far into the whitespace right of
// the article column, and the opened card grows from the same edge. The card
// is narrower than the classic popover because real margins rarely fit 560px.
const MARGIN_MARKER_GAP = 24;
const MARGIN_CARD_WIDTH = 380;
// Below this much usable margin the style falls back to the classic popover:
// a cramped margin card is worse than the old overlay.
const MARGIN_CARD_MIN_WIDTH = 300;
// Two markers whose passages start on the same line would overlap; later ones
// are nudged down by one marker height plus breathing room.
const MARGIN_MARKER_STEP = BADGE_SIZE + 6;

/** The element (the container itself or an ancestor) that would clip content
 *  drawn this far right of the viewport's left edge, or null when nothing
 *  clips. Reader shells sometimes wrap the article in an overflow-hidden or
 *  scrollable column; a marker drawn into that margin would silently vanish
 *  or add a horizontal scrollbar, so such pages fall back to the classic
 *  style. */
function marginClipper(container: Element, rightEdge: number): Element | null {
  for (let el: Element | null = container; el && el !== document.body; el = el.parentElement) {
    const { overflowX, overflow } = getComputedStyle(el);
    const clips = (v: string) => v === "hidden" || v === "clip" || v === "auto" || v === "scroll";
    if ((clips(overflowX) || clips(overflow)) && el.getBoundingClientRect().right < rightEdge) return el;
  }
  return null;
}

/** The right edge, in viewport coordinates, of the text block a passage sits
 *  in. This is the honest edge of the text column: the container found by
 *  findContainer can be a full-width wrapper (Substack's logged-in renderer
 *  centers a narrow column inside a page-wide article element), so measuring
 *  the margin from the container box would see no margin where the eye sees
 *  plenty. */
function passageBlockRight(range: Range, container: Element): number {
  let el: Element | null =
    range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  while (el && el !== container) {
    const display = getComputedStyle(el).display;
    if (display !== "inline" && display !== "contents") return el.getBoundingClientRect().right;
    el = el.parentElement;
  }
  return container.getBoundingClientRect().right;
}

/* Says once per page why the margin style is not being drawn, so a "why is
 * this the old look" report can be answered from the console. */
let lastFallbackReason: string | null = null;
function logMarginFallback(reason: string | null) {
  if (reason === lastFallbackReason) return;
  lastFallbackReason = reason;
  if (reason) console.info(`[common-notes] margin style fell back to classic: ${reason}`);
}

/** Gives the range's rectangle relative to the in-content annotation layer. Both
 *  rectangles are read in the same layout pass, so the pair does not change when
 *  the page scrolls. The layer sits inside the article and moves with the text
 *  under any scroll container. */
function relRect(range: Range, origin: DOMRect) {
  const rect = range.getBoundingClientRect();
  return {
    top: rect.top - origin.top,
    right: rect.right - origin.left,
    bottom: rect.bottom - origin.top,
    left: rect.left - origin.left,
  };
}


/** What a marker is called for a screen reader and in its tooltip: how many
 *  notes the passage has and the status its colour shows. */
function markerLabel(group: ClaimGroup): string {
  const count = group.notes.length === 1 ? "Common Note" : `${group.notes.length} Common Notes`;
  return `${count} on this passage, ${statusLabel(group.status).toLowerCase()}`;
}

/** The markers are real buttons, so they are reachable with Tab and show the
 *  same focus ring as every other control. */
const MARKER_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/** What both marker styles are drawn from. */
interface MarkerProps {
  group: ClaimGroup;
  open: boolean;
  onClick: () => void;
  style: React.CSSProperties;
  label: string;
  ref: React.Ref<HTMLButtonElement>;
}

/** The small badge at the end of an anchored passage. It draws the community
 *  glyph in the colour of the claim's status on a surface that follows the
 *  host page's light or dark theme. A collapsed claim's badge is smaller and
 *  faint until the pointer reaches it. This is the classic style's marker. */
function Badge({ group, open, onClick, style, label, ref }: MarkerProps) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={open}
      style={style}
      className={cn(
        "absolute flex items-center justify-center rounded-full border border-line-strong bg-surface shadow-raised transition hover:scale-110",
        statusColorClass(group.status),
        MARKER_FOCUS,
        group.collapsed && !open && "scale-75 opacity-50 hover:opacity-100",
        open && "ring-2 ring-focus",
      )}
    >
      <GroupIcon />
    </button>
  );
}

/** The margin style's marker: a small dot in the colour of the claim's
 *  status, green for helpful, blue for needs more ratings and red for not
 *  helpful (Jim, 2026-09-29). It gains a soft halo when the pointer is near.
 *  A collapsed claim's dot is smaller and faint until the pointer reaches it.
 *  The button box stays badge-sized so the positioning and collision math is
 *  shared; the dot is drawn smaller inside it. */
function MarginDot({ group, open, onClick, style, label, ref }: MarkerProps) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={open}
      style={style}
      className={cn("absolute flex items-center justify-center rounded-full group", MARKER_FOCUS)}
    >
      <span
        className={cn(
          "rounded-full bg-current transition",
          statusColorClass(group.status),
          group.collapsed ? "h-1.5 w-1.5 opacity-50 group-hover:opacity-100" : "h-2.5 w-2.5",
          !open && "group-hover:ring-4 group-hover:ring-focus-halo",
        )}
      />
    </button>
  );
}

function NotePopover({ group, projectSlug, navigation, style, label, onClose }: {
  group: AnchoredGroup;
  projectSlug: string | null;
  navigation: NoteNavigation;
  style: React.CSSProperties;
  label: string;
  /** Closes the note and returns the focus to its marker. */
  onClose: () => void;
}) {
  const [loginOpen, setLoginOpen] = useState(false);
  // An opened note takes the keyboard focus, so a keyboard reader lands in it
  // instead of having to find it. preventScroll keeps the page where it is.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => card.current?.focus({ preventScroll: true }), []);
  // Escape is handled on the card itself, because the event shield around the
  // overlay keeps key presses inside it from ever reaching the page.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    // The popover has a maximum height and scrolls inside itself. One claim can
    // stack several notes and an open composer, which gets taller than the
    // viewport. The overscroll-contain class stops that inner scroll from
    // carrying on into the host page.
    <div
      ref={card}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={style}
      className={cn(cardVariants({ elevation: "floating" }), "absolute p-4 text-left max-h-[70vh] overflow-y-auto overscroll-contain focus:outline-none")}
    >
      <OverlayLoginGate open={loginOpen} onOpenChange={setLoginOpen}>
        <ClaimNoteStack group={group} projectSlug={projectSlug} navigation={navigation} />
      </OverlayLoginGate>
    </div>
  );
}

/** Every badge and popover for one page. They are rendered through a portal into
 *  the in-content annotation layer and positioned absolutely inside it, so
 *  scrolling moves them along with the text and no JavaScript runs per frame.
 *  The two pieces that are fixed to the viewport, the sign-in hint and the write
 *  modal, stay in the host element at body level. There a transform on an
 *  ancestor of the article cannot break position:fixed. */
export function InlineNotesApp({ groups, item, container, inlineContainer, noteStyle }: {
  groups: AnchoredGroup[];
  item: PageItem;
  /** The article container the ranges live in. It is looked up again on every
   *  render. */
  container: Element;
  /** The React root element of the annotation layer, which sits inside
   *  `container`. */
  inlineContainer: HTMLElement;
  /** "margin" puts the marker and the opened card in the whitespace right of
   *  the article; "classic" is the old badge-and-popover style. Margin falls
   *  back to classic on its own when there is no usable margin. */
  noteStyle: "margin" | "classic";
}) {
  const projectSlug = item.projectSlug;
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [writeSelection, setWriteSelection] = useState<string | null>(null);
  const markers = useRef(new Map<string, HTMLButtonElement>());

  // Closing a note hands the focus back to its marker, the way any dialog
  // returns focus to what opened it.
  const closeNote = useCallback((claimId: string) => {
    setOpenClaim(null);
    markers.current.get(claimId)?.focus({ preventScroll: true });
  }, []);
  // Escape pressed inside the note is handled by the note itself. This covers
  // an Escape pressed anywhere else on the page while a note is open.
  useEffect(() => {
    if (!openClaim) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNote(openClaim);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openClaim, closeNote]);
  // This counter is bumped on a resize, so the positions derived from the ranges
  // are computed again.
  const [layoutTick, setLayoutTick] = useState(0);

  useEffect(() => {
    let raf = 0;
    const relayout = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setLayoutTick((t) => t + 1));
    };
    window.addEventListener("resize", relayout);
    // This scroll listener is only a fallback. The annotation layer lives inside
    // the article, so a scroll of a shared scroller recomputes to exactly the
    // same positions and React writes nothing to the DOM. The listener exists
    // for the rare range that sits in a nested scroller the layer does not
    // share, such as a scrollable code block or table.
    document.addEventListener("scroll", relayout, { capture: true, passive: true });
    // Passages move as the host page's images and embeds finish loading. An
    // <img> that gains height fires no DOM mutation, so the cached positions
    // would drift away from their passage. Observing the body catches changes in
    // the document's height. The article container has to be observed as well.
    // In an inner-scroll layout such as Substack's reader, the body stays locked
    // to the viewport while the article itself grows.
    const resizeObserver = new ResizeObserver(relayout);
    resizeObserver.observe(document.body);
    resizeObserver.observe(container);
    return () => {
      window.removeEventListener("resize", relayout);
      document.removeEventListener("scroll", relayout, { capture: true } as EventListenerOptions);
      resizeObserver.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [container]);

  // The passage tint is a CSS highlight rather than an element, so it cannot
  // receive events. We test every host-page click against each tinted claim's
  // range instead. Clicking a tinted passage then toggles its note, just as
  // clicking the badge does. A collapsed claim has no tint, so its text stays
  // plain page text and only its marker opens it. The listener that closes the popover on an outside press
  // lives here too, and it skips tinted passages. Closing on mousedown and
  // reopening from the click's hit test made a click on a highlight flash the
  // popover shut and open it again straight away.
  useEffect(() => {
    const claimAt = (x: number, y: number): string | null => {
      for (const group of groups) {
        if (group.collapsed) continue;
        for (const rect of group.range.getClientRects()) {
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return group.claimId;
        }
      }
      return null;
    };
    const onDown = (e: MouseEvent) => {
      // Clicks inside our own overlay bubble out of the shadow root as well. The
      // popover overlaps the page text, so without this guard a click on a vote
      // pill would also hit-test the passage underneath and open that passage's
      // note.
      if (insideCommonNotesUi(e) || claimAt(e.clientX, e.clientY)) return;
      // Only a press on empty surface closes the note. A click that does
      // something, such as one on a link or a like button, should not dismiss
      // the note as well.
      if (!isInertClick(e)) return;
      setOpenClaim(null);
    };
    const onClick = (e: MouseEvent) => {
      if (insideCommonNotesUi(e)) return;
      // Dragging out a selection, for example to write a note on some text, ends
      // in a click as well. We leave that click alone.
      if (!window.getSelection()?.isCollapsed) return;
      const claimId = claimAt(e.clientX, e.clientY);
      if (claimId) setOpenClaim((previous) => (previous === claimId ? null : claimId));
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("click", onClick);
    };
  }, [groups]);

  // The claims in document order. The popup's jump button, the request
  // progress card and the Next note button in an open note all step through
  // them, wrapping around at the end.
  const ordered = useMemo(
    () => [...groups].sort((a, b) => a.range.compareBoundaryPoints(Range.START_TO_START, b.range)),
    [groups],
  );
  const openIndex = openClaim ? ordered.findIndex((g) => g.claimId === openClaim) : -1;
  // A jump goes to the claim after the open one, so "next" always means the
  // one after what the reader is looking at. With no claim open it goes to
  // the claim after the last one a jump reached. That cursor lives here so
  // that "next" keeps its place when the popup is closed and opened again. It
  // resets when the page does.
  const jumpCursor = useRef(-1);
  const scrollToOpenedClaim = useRef(false);
  const jumpNext = useCallback(() => {
    if (!ordered.length) return;
    const from = openIndex >= 0 ? openIndex : jumpCursor.current;
    jumpCursor.current = (from + 1) % ordered.length;
    scrollToOpenedClaim.current = true;
    setOpenClaim(ordered[jumpCursor.current]!.claimId);
  }, [ordered, openIndex]);
  // The scroll to a jumped-to passage runs after React has put its note on
  // screen. React restores the page's scroll positions while it updates the
  // page, and that cancels a smooth scroll started before the update.
  useEffect(() => {
    if (!scrollToOpenedClaim.current) return;
    scrollToOpenedClaim.current = false;
    ordered[openIndex]?.range.startContainer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [openClaim, ordered, openIndex]);

  // Handles the two requests that arrive from elsewhere in the extension. The
  // popup asks to jump to the next note. The background's context menu asks to
  // write a note on the current selection.
  useEffect(() => {
    const listener = (message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
      const { type, selection } = (message as { type?: string; selection?: string }) ?? {};
      if (type === "cn-jump-state") sendResponse({ jumped: jumpCursor.current >= 0 });
      if (type === "cn-jump-note" && ordered.length) {
        jumpNext();
        sendResponse({ jumped: true });
      }
      if (type === "cn-write-note" && selection?.trim()) setWriteSelection(selection.trim());
    };
    browser.runtime.onMessage.addListener(listener);
    // The request progress card jumps through the same cursor, see utils/jumpBus.ts.
    setJumpHandler(jumpNext);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      setJumpHandler(null);
    };
  }, [ordered, jumpNext]);

  const positioned = useMemo(() => {
    // Read the layer's origin and every range rectangle in the same layout pass.
    // Never cache the origin across renders. The two would then come from
    // different scroll positions, and the result would no longer hold as the
    // page scrolls.
    const origin = inlineContainer.getBoundingClientRect();

    // Whether the margin style can actually be drawn here. The body fallback
    // container has no margin by construction; a too-narrow window has no room
    // for the card; a clipping ancestor would swallow the marker. Every
    // failure falls back to the classic style rather than to nothing.
    // The markers all sit on one vertical rail just right of the text column.
    // The column's edge is the widest passage block, capped at the container
    // box (a block cannot honestly be wider than the article).
    const containerRect = container.getBoundingClientRect();
    const columnRight = groups.length
      ? Math.min(containerRect.right, Math.max(...groups.map((g) => passageBlockRight(g.range, container))))
      : containerRect.right;
    const marginLeft = columnRight + MARGIN_MARKER_GAP;
    const availableMargin = window.innerWidth - marginLeft - VIEWPORT_MARGIN;
    const clipper = marginClipper(container, marginLeft + BADGE_SIZE);
    const fallbackReason =
      noteStyle !== "margin"
        ? null // Classic was chosen in the settings; nothing to explain.
        : availableMargin < MARGIN_CARD_MIN_WIDTH
          ? `only ${Math.round(availableMargin)}px of margin right of the text column, the card needs ${MARGIN_CARD_MIN_WIDTH}px`
          : clipper
            ? `an element would clip the margin (<${clipper.tagName.toLowerCase()} class="${clipper.className}">)`
            : null;
    logMarginFallback(fallbackReason);
    const useMargin = noteStyle === "margin" && fallbackReason === null;

    // Markers of passages that start on the same lines would land on top of
    // each other; walking them from top to bottom and pushing each below the
    // previous keeps every one clickable. The nudged tops are computed per
    // group first, because `groups` arrives in fetch order, not page order.
    const rects = groups.map((group) => relRect(group.range, origin));
    const marginTops = new Map<AnchoredGroup, number>();
    if (useMargin) {
      let previousBottom = -Infinity;
      for (const index of [...groups.keys()].sort((a, b) => rects[a]!.top - rects[b]!.top)) {
        const top = Math.max(rects[index]!.top, previousBottom + MARGIN_MARKER_STEP - BADGE_SIZE);
        previousBottom = top + BADGE_SIZE;
        marginTops.set(groups[index]!, top);
      }
    }

    return groups.map((group, index) => {
      const rect = rects[index]!;
      if (useMargin) {
        const left = marginLeft - origin.left;
        return {
          group,
          margin: true,
          badgeStyle: { top: marginTops.get(group)!, left, width: BADGE_SIZE, height: BADGE_SIZE } satisfies React.CSSProperties,
          popoverStyle: {
            top: rect.top,
            left,
            width: Math.min(MARGIN_CARD_WIDTH, availableMargin),
            zIndex: 2,
          } satisfies React.CSSProperties,
        };
      }
      // Keep the popover inside the viewport, with the numbers expressed in the
      // layer's own coordinates. A client x equals the layer x plus origin.left,
      // so a viewport edge at M becomes M - origin.left here.
      const popLeft = Math.max(
        VIEWPORT_MARGIN - origin.left,
        Math.min(rect.left, window.innerWidth - NOTE_POPOVER_WIDTH - VIEWPORT_MARGIN - origin.left),
      );
      return {
        group,
        margin: false,
        badgeStyle: {
          top: rect.top - BADGE_SIZE / 2,
          left: rect.right + BADGE_GAP,
          width: BADGE_SIZE,
          height: BADGE_SIZE,
        } satisfies React.CSSProperties,
        popoverStyle: {
          top: rect.bottom + POPOVER_GAP,
          left: popLeft,
          width: Math.min(NOTE_POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2),
          zIndex: 2,
        } satisfies React.CSSProperties,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, layoutTick, inlineContainer, container, noteStyle]);

  return (
    <EventShield>
      {writeSelection && (
        <WriteNoteOverlay item={item} selection={writeSelection} onClose={() => setWriteSelection(null)} />
      )}
      {/* The badges and popovers are portalled into the in-content annotation
          layer, so they scroll with the text. A second shield absorbs events on
          that side. */}
      {createPortal(
        <EventShield>
          {positioned.map(({ group, badgeStyle, popoverStyle, margin }) => {
            const marker = {
              group,
              ref: (el: HTMLButtonElement | null) => {
                if (el) markers.current.set(group.claimId, el);
                else markers.current.delete(group.claimId);
              },
              label: markerLabel(group),
              open: openClaim === group.claimId,
              onClick: () => setOpenClaim((cur) => (cur === group.claimId ? null : group.claimId)),
              style: badgeStyle,
            };
            return (
              <div key={group.claimId}>
                {margin ? <MarginDot {...marker} /> : <Badge {...marker} />}
                {openClaim === group.claimId && (
                  <NotePopover
                    group={group}
                    projectSlug={projectSlug}
                    navigation={{ position: openIndex + 1, total: ordered.length, onNext: jumpNext }}
                    style={popoverStyle}
                    label={marker.label}
                    onClose={() => closeNote(group.claimId)}
                  />
                )}
              </div>
            );
          })}
        </EventShield>,
        inlineContainer,
      )}
    </EventShield>
  );
}
