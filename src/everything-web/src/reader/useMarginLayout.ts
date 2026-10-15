import { useEffect, useLayoutEffect, useRef } from "react";

/** The space between two cards in the margin, in pixels. */
const CARD_GAP_PX = 16;
/** A card the reader has not touched shows only when it lands at most this far
 *  below its words. Further down it would sit beside unrelated text, so it
 *  stays a dot until the reader opens it. This is the extension's rule. */
const MAX_DRIFT_PX = 200;
/** The height assumed for a card that has never been on screen. */
const UNMEASURED_CARD_HEIGHT_PX = 320;
/** Dots whose words start on the same line would overlap, so each one sits at
 *  least this far below the one above. */
const DOT_STEP_PX = 18;

/** The last height each card had while it was on screen. A dot's card is
 *  hidden and measures zero, so its old height is what the next pass uses. */
const cardHeights = new WeakMap<HTMLElement, number>();

interface Slot {
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
    const passage = slot.closest(".reader-passage")!;
    const mark = passage.querySelector(`mark[data-key="${CSS.escape(slot.dataset.slot!)}"]`);
    const card = slot.querySelector<HTMLElement>(".reader-slot-card")!;
    if (slot.dataset.shown !== "dot" && card.offsetHeight > 0) cardHeights.set(card, card.offsetHeight);
    return {
      slot, card, dot: slot.querySelector<HTMLElement>(".reader-dot"),
      passageTop: topOf(passage),
      anchorTop: mark ? topOf(mark) : topOf(passage),
      priority: Number(slot.dataset.priority),
      mode: slot.dataset.mode ?? "auto",
    };
  });
}

/** Places every margin entry as a card or a dot, as the extension does. Each
 *  card starts level with its own words, and a card that would overlap the
 *  one above moves down below it. Within a passage the entries claim room in
 *  priority order, after any card the reader opened. A card the reader has
 *  not touched shows only if that push leaves it close to its words.
 *  Otherwise it shrinks to a dot on a rail
 *  between the text and the cards, level with its words. A card the reader
 *  opened always shows, and one the reader closed is always a dot. The
 *  article grows at the bottom when the margin runs past its last passage. */
function layoutMargin(root: HTMLElement) {
  // A card the reader opened claims its place first, so it lands beside its
  // words and the untouched cards of its passage move around it.
  const openedFirst = (slot: Slot) => (slot.mode === "opened" ? 0 : 1);
  const slots = readSlots(root).sort((a, b) => a.passageTop - b.passageTop || openedFirst(a) - openedFirst(b) || a.priority - b.priority || a.anchorTop - b.anchorTop);
  let cardFloor = 0;
  const dots: Slot[] = [];
  for (const entry of slots) {
    const top = Math.max(entry.anchorTop, cardFloor);
    const fits = entry.mode === "opened" || (entry.mode === "auto" && top - entry.anchorTop <= MAX_DRIFT_PX);
    if (!fits) {
      dots.push(entry);
      continue;
    }
    entry.slot.dataset.shown = "card";
    entry.card.style.top = `${top - entry.passageTop}px`;
    cardFloor = top + (cardHeights.get(entry.card) ?? UNMEASURED_CARD_HEIGHT_PX) + CARD_GAP_PX;
  }
  let dotFloor = -Infinity;
  for (const entry of dots.sort((a, b) => a.anchorTop - b.anchorTop)) {
    const top = Math.max(entry.anchorTop, dotFloor);
    entry.slot.dataset.shown = "dot";
    if (entry.dot) entry.dot.style.top = `${top - entry.passageTop}px`;
    dotFloor = top + DOT_STEP_PX;
  }
  root.style.paddingBottom = "";
  const overflow = Math.max(cardFloor, dotFloor) - root.getBoundingClientRect().height;
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
