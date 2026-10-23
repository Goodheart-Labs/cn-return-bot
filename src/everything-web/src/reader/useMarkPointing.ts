import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ReaderApi } from "./context";

const ACTIVE_CLASS = "reader-active";

const slotOf = (root: HTMLElement, key: string) => root.querySelector<HTMLElement>(`[data-slot="${CSS.escape(key)}"]`);

/** The entry under the pointer: the innermost mark, which is the shortest
 *  quote there, or the margin slot the pointer is over. */
function keyAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const mark = target.closest<HTMLElement>("mark[data-key]");
  if (mark) return mark.dataset.key!;
  return target.closest<HTMLElement>("[data-slot]")?.dataset.slot ?? null;
}

/** Lights up exactly one entry's words and its dot or card. */
function setActive(root: HTMLElement, key: string | null) {
  root.querySelectorAll(`.${ACTIVE_CLASS}`).forEach((element) => element.classList.remove(ACTIVE_CLASS));
  if (!key) return;
  root.querySelectorAll(`mark[data-key="${CSS.escape(key)}"]`).forEach((element) => element.classList.add(ACTIVE_CLASS));
  slotOf(root, key)?.classList.add(ACTIVE_CLASS);
}

/** Connects the marked words with their margin entries on wide screens.
 *  Pointing at marked words, or at a dot or a card, lights up exactly that
 *  entry's words. Where quotes overlap, the shortest one wins. A click on
 *  marked words opens their entry's card, and a second click closes a card
 *  the reader opened that way. Positions and classes are written straight to
 *  the page, like the margin layout, because they follow the pointer. */
export function useMarkPointing(article: RefObject<HTMLElement | null>, wide: boolean, api: Pick<ReaderApi, "slotMode" | "openEntry" | "closeEntry">) {
  // The handlers read the latest api through a ref, so a re-render does not
  // tear them down and clear the lit-up words under a resting pointer.
  const latest = useRef(api);
  useLayoutEffect(() => { latest.current = api; });
  useEffect(() => {
    const root = article.current;
    if (!wide || !root) return;
    let active: string | null = null;
    const point = (event: Event) => {
      const key = keyAt(event.target);
      if (key === active) return;
      active = key;
      setActive(root, key);
    };
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("a, button")) return;
      const key = target.closest<HTMLElement>("mark[data-key]")?.dataset.key;
      if (!key) return;
      const { slotMode, openEntry, closeEntry } = latest.current;
      const shownAsCard = slotOf(root, key)?.dataset.shown === "card";
      if (shownAsCard && slotMode(key) === "opened") closeEntry(key);
      else openEntry(key);
    };
    root.addEventListener("pointerover", point);
    root.addEventListener("pointerleave", point);
    root.addEventListener("focusin", point);
    root.addEventListener("click", click);
    return () => {
      root.removeEventListener("pointerover", point);
      root.removeEventListener("pointerleave", point);
      root.removeEventListener("focusin", point);
      root.removeEventListener("click", click);
      setActive(root, null);
    };
  }, [article, wide]);
}
