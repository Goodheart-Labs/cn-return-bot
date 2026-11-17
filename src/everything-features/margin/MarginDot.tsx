import type { CSSProperties, Ref } from "react";
import { cn } from "@cn/ui/cn";
import { focusRing } from "@cn/ui/focusRing";
import { MARKER_SIZE } from "@cn/core/marginCards";

/** The event handlers that report pointing at a marker. */
export const pointHandlers = (onPoint: (pointing: boolean) => void) => ({
  onMouseEnter: () => onPoint(true),
  onMouseLeave: () => onPoint(false),
  onFocus: () => onPoint(true),
  onBlur: () => onPoint(false),
});

/** A margin marker: a small dot in the colour of what it opens. For a note
 *  that is its status, green for helpful, blue for needs more ratings and red
 *  for not helpful (Jim, 2026-09-29). It gains a soft halo when the pointer is
 *  near. The button box is marker-sized so the positioning and collision math
 *  is shared; the dot is drawn smaller inside it. The extension and the
 *  minisite reader both draw their margin with it. */
export function MarginDot({ colorClass, open, onClick, onPoint, style, label, className, ref }: {
  /** A text colour class; the dot is drawn in the current colour. */
  colorClass: string;
  open: boolean;
  onClick: () => void;
  /** Called with true when the pointer or the keyboard focus reaches the
   *  marker, and with false when it leaves. */
  onPoint?: (pointing: boolean) => void;
  style?: CSSProperties;
  label: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      {...(onPoint && pointHandlers(onPoint))}
      title={label}
      aria-label={label}
      aria-expanded={open}
      style={style ?? { width: MARKER_SIZE, height: MARKER_SIZE }}
      className={cn("absolute flex items-center justify-center rounded-full group", focusRing, className)}
    >
      <span className={cn("h-2.5 w-2.5 rounded-full bg-current transition", colorClass, !open && "group-hover:ring-4 group-hover:ring-focus-halo")} />
    </button>
  );
}
