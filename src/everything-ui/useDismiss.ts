import { useEffect, useEffectEvent, type RefObject } from "react";
import { useOutsidePress } from "./useOutsidePress";

/** Closes an open menu, popover or card the usual ways: a press outside `ref`,
 *  or Escape. After Escape, focus goes back to `returnFocus`, which is usually
 *  the button that opened it, so a keyboard user does not lose their place. A
 *  second click on that button is the caller's toggle. */
export function useDismiss(ref: RefObject<Element | null>, open: boolean, onDismiss: () => void, returnFocus?: RefObject<HTMLElement | null>) {
  useOutsidePress(ref, open, onDismiss);
  const dismissByKey = useEffectEvent(() => {
    onDismiss();
    returnFocus?.current?.focus();
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissByKey();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
}
