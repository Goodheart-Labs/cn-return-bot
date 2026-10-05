import { useState } from "react";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { CloseIcon } from "@cn/ui/icons";
import { IconButton } from "@cn/ui/IconButton";
import { useAutoDismiss } from "@cn/ui/useAutoDismiss";

/** How long the overlay stays before it fades out on its own. Hovering pauses
 *  the clock, so a reader who is about to click never loses the card. */
const AUTO_HIDE_MS = 7_000;
/** How long the fade-out takes once the clock has run out. Hovering during the
 *  fade brings the card back. */
const FADE_MS = 700;

/** The transient card that says how a note request went: that it was saved,
 *  or why it was not needed. It fades away after a few seconds so it never
 *  becomes furniture. */
export function StatusOverlay({ headline }: { headline: string }) {
  const [hovered, setHovered] = useState(false);
  // Keyboard focus inside the card holds it just like the pointer does, so a
  // keyboard user is never timed out of it.
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const { fading } = useAutoDismiss({ dwellMs: AUTO_HIDE_MS, fadeMs: FADE_MS, paused: hovered || focused, onDismiss: () => setHidden(true) });

  if (hidden) return null;
  return (
    <div
      className={cn(cardVariants({ elevation: "floating" }), "max-w-[24rem] p-4 transition-opacity ease-out", fading ? "opacity-0" : "opacity-100")}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-fg">{headline}</p>
        <IconButton label="Dismiss" className="ml-auto" onClick={() => setHidden(true)}>
          <CloseIcon size={14} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
