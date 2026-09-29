import { useEffect } from "react";

/** The background colour a reader sees at a point of the window: the colour of
 *  the first element under that point, or of its nearest ancestor, that has
 *  a colour of its own. */
function backgroundAt(x: number, y: number): string | null {
  for (let el = document.elementFromPoint(x, y); el && el !== document.documentElement; el = el.parentElement) {
    const color = getComputedStyle(el).backgroundColor;
    if (color !== "transparent" && !color.endsWith(", 0)")) return color;
  }
  return null;
}

/** Colours the area the browser shows when the page is scrolled past its top
 *  or bottom edge, the "overscroll" bounce of a trackpad. That area takes the
 *  background of <html>, and a page can only bounce at one edge at a time.
 *  So in the upper half of the page <html> takes the colour at the top of the
 *  window, the header's, and in the lower half the colour at the bottom of the
 *  window, the footer's. The page then seems to continue past either edge, in
 *  any theme and on any page. */
export function OverscrollColor() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const maxScroll = root.scrollHeight - window.innerHeight;
      const edgeY = window.scrollY <= maxScroll / 2 ? 0 : window.innerHeight - 1;
      root.style.backgroundColor = backgroundAt(0, edgeY) ?? "";
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // A page change, or a theme change, alters the colours without a scroll.
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);
  return null;
}
