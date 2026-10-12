import { useEffect, useEffectEvent, type RefObject } from "react";

/** Calls `onOutside` when a press lands outside `ref`, while `active` is true.
 *  Menus and popovers close this way. The listener runs in the capture phase
 *  and checks the event's composed path, because the extension renders inside
 *  shadow roots and its overlays stop mousedown events from bubbling, so the
 *  host page never sees them. A bubble-phase listener that compared targets
 *  would then never learn about a press inside the card. */
export function useOutsidePress(ref: RefObject<Element | null>, active: boolean, onOutside: () => void) {
  const outside = useEffectEvent(onOutside);
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !e.composedPath().includes(ref.current)) outside();
    };
    document.addEventListener("mousedown", onDown, { capture: true });
    return () => document.removeEventListener("mousedown", onDown, { capture: true });
  }, [ref, active]);
}
