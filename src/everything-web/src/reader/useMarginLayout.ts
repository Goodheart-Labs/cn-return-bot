import { useEffect, useLayoutEffect, useRef } from "react";

/** The space between two margin groups, in pixels. */
const GROUP_GAP_PX = 16;

/** Places every margin group level with the words it is about, as margin
 *  comments do. Each group sits inside its passage in the page structure, so
 *  keyboard and screen reader order follow the text, and is drawn in the
 *  margin by absolute positioning. A group lines up with the first marked
 *  quote in its passage, or with the passage's top when nothing is marked. A
 *  group that would overlap the one above moves down below it. The article
 *  grows at the bottom when the margin runs past its last passage. */
function layoutMargin(root: HTMLElement) {
  const base = root.getBoundingClientRect().top;
  let floor = 0;
  for (const group of Array.from(root.querySelectorAll<HTMLElement>("[data-margin-group]"))) {
    const passage = group.parentElement!;
    const passageTop = passage.getBoundingClientRect().top - base;
    const firstMark = passage.querySelector<HTMLElement>("[data-mark]");
    const anchorTop = firstMark ? firstMark.getBoundingClientRect().top - base : passageTop;
    const top = Math.max(anchorTop, floor);
    group.style.top = `${top - passageTop}px`;
    floor = top + group.offsetHeight + GROUP_GAP_PX;
  }
  root.style.paddingBottom = "";
  const overflow = floor - root.getBoundingClientRect().height;
  if (overflow > 0) root.style.paddingBottom = `${overflow}px`;
}

/** Returns the ref for the article element and keeps its margin laid out.
 *  Positions are written straight to the page, not kept in React state,
 *  because they depend on rendered heights, which change as fonts load, cards
 *  expand and answers arrive. The pass runs after every render, on resize,
 *  and whenever the article or a group changes size or a group appears. */
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
    const watchGroups = () => root.querySelectorAll("[data-margin-group]").forEach((group) => resize.observe(group));
    // Setting a group's position changes only its style attribute, so watching
    // added and removed elements cannot loop.
    const added = new MutationObserver(() => { watchGroups(); run(); });
    resize.observe(root);
    watchGroups();
    added.observe(root, { childList: true, subtree: true });
    window.addEventListener("resize", run);
    return () => {
      resize.disconnect();
      added.disconnect();
      window.removeEventListener("resize", run);
    };
  }, [enabled]);

  return article;
}
