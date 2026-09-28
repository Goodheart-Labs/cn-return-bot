import { useState } from "react";
import { Button } from "@cn/ui/Button";
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

type ActionPhase = "idle" | "busy" | "done" | "error";

/** One action button: the label, the confirmation text once it ran, and what
 *  it does. `alreadyDone` starts true when the action has already been taken,
 *  so the card shows the confirmation instead of the button. Only the popup
 *  renders one of these; the in-page card has been headline-only since the
 *  request and follow cards were removed (GOO-71). */
export interface StatusAction {
  label: string;
  doneLabel: string;
  alreadyDone: boolean;
  run: () => Promise<void>;
}

export interface StatusOverlayProps {
  /** The card's first line. */
  headline: string;
  /** Makes the headline clickable. The note-count card passes the jump here,
   *  so clicking the card walks the notes like the popup's jump button. */
  onHeadlineClick?: () => void;
}

export function ActionButton({ action }: { action: StatusAction }) {
  const [phase, setPhase] = useState<ActionPhase>(action.alreadyDone ? "done" : "idle");

  const run = async () => {
    setPhase("busy");
    try {
      await action.run();
      setPhase("done");
    } catch {
      setPhase("error");
    }
  };

  if (phase === "done") return <p className="text-sm text-positive">{action.doneLabel}</p>;
  return (
    <div>
      <Button className="w-full" onClick={run} disabled={phase === "busy"}>
        {action.label}
      </Button>
      {phase === "error" && <p className="mt-2 text-sm text-negative">Something went wrong. Try again</p>}
    </div>
  );
}

/** The transient status card shown when a page opens. It says how the page
 *  stands, and it fades away after a few seconds so it never becomes
 *  furniture. */
export function StatusOverlay({ headline, onHeadlineClick }: StatusOverlayProps) {
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(false);
  const { fading } = useAutoDismiss({ dwellMs: AUTO_HIDE_MS, fadeMs: FADE_MS, paused: hovered, onDismiss: () => setHidden(true) });

  if (hidden) return null;
  return (
    <div
      className={cn(cardVariants({ elevation: "floating" }), "max-w-[24rem] p-4 transition-opacity ease-out", fading ? "opacity-0" : "opacity-100")}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start justify-between gap-2">
        {onHeadlineClick ? (
          <button
            onClick={onHeadlineClick}
            className="text-left text-sm font-medium text-fg underline-offset-2 hover:underline"
          >
            {headline}
          </button>
        ) : (
          <p className="text-sm font-medium text-fg">{headline}</p>
        )}
        <IconButton label="Dismiss" className="ml-auto" onClick={() => setHidden(true)}>
          <CloseIcon size={14} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
