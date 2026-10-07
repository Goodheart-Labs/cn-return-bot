import { useEffect, useRef } from "react";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { CloseIcon } from "@cn/ui/icons";
import { IconButton } from "@cn/ui/IconButton";
import { useOutsidePress } from "@cn/ui/useOutsidePress";

/** What a listing badge stands for: the number of notes the reader will see on
 *  the linked page, or a page we read in full and found nothing to note on. */
export type BadgeMark = { count: number } | { checked: true };

export const BADGE_CARD_WIDTH_PX = 256;

function badgeCardText(mark: BadgeMark, noun: "post" | "video"): { heading: string; body: string } {
  if ("checked" in mark) {
    return { heading: "Fact-checked", body: `We checked this ${noun} and found nothing that needs a correction.` };
  }
  return {
    heading: mark.count === 1 ? "1 Common Note" : `${mark.count} Common Notes`,
    body: `Open this ${noun} to read ${mark.count === 1 ? "it" : "them"}.`,
  };
}

/** The small card a click on a listing badge opens. It explains the badge in
 *  one sentence. A press anywhere else, the Escape key or the close button
 *  closes it. */
export function BadgeCard({ mark, noun, onClose }: { mark: BadgeMark; noun: "post" | "video"; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsidePress(ref, true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const { heading, body } = badgeCardText(mark, noun);
  return (
    <div ref={ref} role="dialog" aria-label={heading} className={cn(cardVariants({ elevation: "floating" }), "p-3")} style={{ width: BADGE_CARD_WIDTH_PX }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-fg">{heading}</p>
        <IconButton label="Close" className="-mr-1 -mt-1" onClick={onClose}>
          <CloseIcon size={14} aria-hidden />
        </IconButton>
      </div>
      <p className="mt-1 text-sm text-fg-secondary">{body}</p>
    </div>
  );
}
