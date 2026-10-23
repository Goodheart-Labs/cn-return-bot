import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@cn/ui/Button";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { useOutsidePress } from "@cn/ui/useOutsidePress";

/** A Filters button that opens a popover with the page's filter controls.
 *  A second click on the button, a press outside the popover, or Escape closes
 *  it. The page does not close it on scroll, because filtering changes the
 *  feed's length and the page can scroll by itself while a slider is dragged.
 *  The button shows how many filters are switched on.
 *  The popover hangs below the nearest positioned ancestor, which the page
 *  picks. On a phone it spans that ancestor's whole width, because the button
 *  may have wrapped to the left edge. On a wider screen it sits at the right. */
export function FiltersPopover({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useOutsidePress(ref, open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div ref={ref}>
      <Button ref={buttonRef} variant="secondary" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((wasOpen) => !wasOpen)}>
        {activeCount > 0 ? `Filters (${activeCount})` : "Filters"}
      </Button>
      {open && (
        <div role="dialog" aria-label="Filters" className={cn(cardVariants({ elevation: "floating" }), "absolute inset-x-0 top-full z-20 mt-2 space-y-4 p-4 sm:left-auto sm:w-72")}>
          {children}
        </div>
      )}
    </div>
  );
}
