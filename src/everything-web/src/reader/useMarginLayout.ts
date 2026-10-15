import { useEffect, useLayoutEffect, useRef } from "react";
import { MARKER_SIZE, placeMarginCards, placeMarkers, UNMEASURED_CARD_HEIGHT } from "@cn/core/marginCards";

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

/** Places every margin entry with the extension's own rules
 *  (`@cn/core/marginCards`). Each card starts level with its own words, and a
 *  card that would overlap the one above moves down below it. A card the
 *  reader has not touched shows only if that push leaves it close to its
 *  words; otherwise only its dot shows. A card the reader opened always
 *  shows, and one the reader closed is always a dot. Entries whose words
 *  start on the same line claim room in priority order. The article grows at
 *  the bottom when the margin runs past its last passage. */
function layoutMargin(root: HTMLElement) {
  const slots = readSlots(root).sort((a, b) => a.anchorTop - b.anchorTop || a.priority - b.priority);
  const heights = new Map(slots.flatMap((entry) => {
    const height = cardHeights.get(entry.card);
    return height === undefined ? [] : [[entry.key, height] as const];
  }));
  const cardTops = placeMarginCards(
    slots.filter((entry) => entry.mode !== "closed").map((entry) => ({ claimId: entry.key, passageTop: entry.anchorTop, openedByReader: entry.mode === "opened" })),
    heights,
  );
  const shownCards = slots.flatMap((entry) => {
    const top = cardTops.get(entry.key);
    return top === undefined ? [] : [{ top, bottom: top + (heights.get(entry.key) ?? UNMEASURED_CARD_HEIGHT) }];
  });
  const markerTops = placeMarkers(slots.filter((entry) => !cardTops.has(entry.key)).map((entry) => ({ key: entry.key, top: entry.anchorTop })), shownCards);
  let bottom = 0;
  for (const entry of slots) {
    const cardTop = cardTops.get(entry.key);
    if (cardTop !== undefined) {
      entry.slot.dataset.shown = "card";
      entry.card.style.top = `${cardTop - entry.passageTop}px`;
      bottom = Math.max(bottom, cardTop + (heights.get(entry.key) ?? 0));
    } else {
      const markerTop = markerTops.get(entry.key)!;
      entry.slot.dataset.shown = "dot";
      if (entry.dot) entry.dot.style.top = `${markerTop - entry.passageTop}px`;
      bottom = Math.max(bottom, markerTop + MARKER_SIZE);
    }
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
