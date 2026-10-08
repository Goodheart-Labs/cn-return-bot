import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";

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
 *  what the badge means. mountBadgeCard decides when it closes. */
export function BadgeCard({ mark, noun }: { mark: BadgeMark; noun: "post" | "video" }) {
  const text = badgeCardText(mark, noun);
  return (
    <div role="tooltip" aria-label={text} className={cn(cardVariants({ elevation: "floating" }), "px-3 py-2")} style={{ width: "max-content", maxWidth: CARD_MAX_WIDTH_PX }}>
      <p className="text-sm text-fg">{text}</p>
    </div>
  );
}
