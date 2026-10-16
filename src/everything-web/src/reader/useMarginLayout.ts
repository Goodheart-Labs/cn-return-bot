import { useEffect, useLayoutEffect, useRef } from "react";
import { flowMarginColumn, MARKER_SIZE, UNMEASURED_CARD_HEIGHT, type ColumnMode } from "@cn/core/marginCards";

/** The last height each card had while it was on screen. A dot's card is
 *  hidden and measures zero, so its old height is what the next pass uses. */
const cardHeights = new WeakMap<HTMLElement, number>();

interface Slot {
  key: string;
  slot: HTMLElement;
  card: HTMLElement;
  dot: HTMLElement | null;
  passageTop: number;
  anchorTop: number;
  priority: number;
  mode: string;
}

function readSlots(root: HTMLElement): Slot[] {
  const base = root.getBoundingClientRect().top;
  const topOf = (element: Element) => element.getBoundingClientRect().top - base;
  return Array.from(root.querySelectorAll<HTMLElement>("[data-margin-group] [data-slot]")).map((slot) => {
    const key = slot.dataset.slot!;
    const passage = slot.closest(".reader-passage")!;
    const mark = passage.querySelector(`mark[data-key="${CSS.escape(key)}"]`);
    const card = slot.querySelector<HTMLElement>(".reader-slot-card")!;
    if (slot.dataset.shown !== "dot" && card.offsetHeight > 0) cardHeights.set(card, card.offsetHeight);
    return {
      key, slot, card, dot: slot.querySelector<HTMLElement>(".reader-dot"),
      passageTop: topOf(passage),
      anchorTop: mark ? topOf(mark) : topOf(passage),
      priority: Number(slot.dataset.priority),
      mode: slot.dataset.mode ?? "auto",
    };
  });
}

/** Lays the margin out as one column with `flowMarginColumn`: every entry
 *  sits at its words or right below the entry above it, as a card or a dot.
 *  Entries whose words start on the same line go in priority order. The
 *  article grows at the bottom when the margin runs past its last passage. */
function layoutMargin(root: HTMLElement) {
  const slots = readSlots(root).sort((a, b) => a.anchorTop - b.anchorTop || a.priority - b.priority);
  const layout = flowMarginColumn(slots.map((entry) => ({
    key: entry,
    anchor: entry.anchorTop,
    height: cardHeights.get(entry.card),
    mode: entry.mode as ColumnMode,
  })));
  let bottom = 0;
  for (const [entry, { top, shown }] of layout) {
    entry.slot.dataset.shown = shown;
    const element = shown === "card" ? entry.card : entry.dot;
    if (element) element.style.top = `${top - entry.passageTop}px`;
    bottom = Math.max(bottom, top + (shown === "card" ? cardHeights.get(entry.card) ?? UNMEASURED_CARD_HEIGHT : MARKER_SIZE));
  }
  root.style.paddingBottom = "";
  const overflow = bottom - root.getBoundingClientRect().height;
  if (overflow > 0) root.style.paddingBottom = `${overflow}px`;
}

/** Returns the ref for the article element and keeps its margin laid out.
 *  Positions are written straight to the page, not kept in React state,
 *  because they depend on rendered heights, which change as fonts load, cards
 *  expand and answers arrive. The pass runs after every render, on resize,
 *  and whenever the article or a card changes size or a card appears. */
export function useMarginLayout(enabled: boolean) {
  const article = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (enabled && article.current) layoutMargin(article.current);
  });

  useEffect(() => {
    const root = article.current;
    if (!enabled || !root) return;
    const run = () => layoutMargin(root);
    const resize = new ResizeObserver(run);
    const watchCards = () => root.querySelectorAll(".reader-slot-card").forEach((card) => resize.observe(card));
    // Setting a card's position changes only its style and data attributes,
    // so watching added and removed elements cannot loop.
    const added = new MutationObserver(() => { watchCards(); run(); });
    resize.observe(root);
    watchCards();
    added.observe(root, { childList: true, subtree: true });
    window.addEventListener("resize", run);
    return () => {
      resize.disconnect();
      added.disconnect();
      window.removeEventListener("resize", run);
      root.querySelectorAll<HTMLElement>("[data-slot]").forEach((slot) => { delete slot.dataset.shown; });
    };
  }, [enabled]);

  return article;
}
