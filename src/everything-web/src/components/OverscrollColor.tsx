import { useEffect } from "react";

/** Colours the area the browser shows when the page is scrolled past its top
 *  or bottom edge, the "overscroll" bounce of a trackpad. That area takes the
 *  background of <html>, which the page body otherwise covers. So in the upper
 *  half of the page <html> takes the header's colour, and the header seems to
 *  continue upward; in the lower half it takes the page colour, which the
 *  footer sits on, and the page seems to continue downward. */
export function OverscrollColor() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const maxScroll = root.scrollHeight - window.innerHeight;
      const upperHalf = window.scrollY <= maxScroll / 2;
      root.classList.toggle("bg-surface", upperHalf);
      root.classList.toggle("bg-canvas", !upperHalf);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return null;
}
