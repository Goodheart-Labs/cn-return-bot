import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReaderAction } from "./context";

/** The gap between the selected words and the toolbar, in pixels. */
const GAP_PX = 8;
/** The toolbar keeps at least this distance from the window's edges. */
const EDGE_PX = 8;

const coarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

/** The toolbar above selected words. On touch screens it sits below them, so
 *  the system's own copy menu, which opens above a selection, does not cover it. */
export function SelectionToolbar({ range, actions }: { range: Range; actions: readonly ReaderAction[] }) {
  const bar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const rect = range.getBoundingClientRect();
      const element = bar.current;
      if (!element) return;
      const { width, height } = element.getBoundingClientRect();
      const below = coarsePointer() || rect.top - height - GAP_PX < EDGE_PX;
      const top = below ? rect.bottom + GAP_PX : rect.top - height - GAP_PX;
      const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, EDGE_PX), window.innerWidth - width - EDGE_PX);
      setPosition({ top, left });
    };
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [range]);

  // Escape clears the selection, which hides the toolbar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") document.getSelection()?.removeAllRanges(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div ref={bar} role="toolbar" aria-label="Actions on the selected words" className="reader-selection-toolbar"
      style={position ? { top: position.top, left: position.left } : { visibility: "hidden" }}>
      {actions.map((action) => (
        <button key={action.key} type="button" aria-label={action.accessibleName}
          // Pressing a button must not clear the selection it is about to use.
          onMouseDown={(event) => event.preventDefault()}
          onClick={action.onSelect}>
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
