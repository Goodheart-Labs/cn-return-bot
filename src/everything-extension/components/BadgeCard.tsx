import { useEffect } from "react";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { listenForDismissingClicks } from "../utils/inertClick";

/** What a listing badge stands for: the number of notes the reader will see on
 *  the linked page, or a page we read in full and found nothing to note on. */
export type BadgeMark = { count: number } | { checked: true };

const CARD_MAX_WIDTH_PX = 256;

/* The sentences are the popup's own status sentences, so the badge and the
 * popup describe a page the same way. Like those, they carry no trailing dot. */
function badgeCardText(mark: BadgeMark, noun: "post" | "video"): string {
  if ("checked" in mark) return `We checked this ${noun} and found nothing to note`;
  const surface = noun === "video" ? "video" : "page";
  return `${mark.count} Common ${mark.count === 1 ? "Note" : "Notes"} on this ${surface}`;
}

/** The small card a click on a listing badge opens. It says in one sentence
 *  what the badge means. It closes the way an open note does: on a click on
 *  empty page surface, or on Escape. A second click on the badge closes it
 *  too, which mountBadgeCard handles because the badge stops its own clicks. */
export function BadgeCard({ mark, noun, onClose }: { mark: BadgeMark; noun: "post" | "video"; onClose: () => void }) {
  useEffect(() => listenForDismissingClicks(onClose), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const text = badgeCardText(mark, noun);
  return (
    <div role="dialog" aria-label={text} className={cn(cardVariants({ elevation: "floating" }), "px-3 py-2")} style={{ width: "max-content", maxWidth: CARD_MAX_WIDTH_PX }}>
      <p className="text-sm text-fg">{text}</p>
    </div>
  );
}
