import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { focusRing } from "@cn/ui/focusRing";
import { CloseIcon, NoteStackIcon } from "@cn/ui/icons";
import { IconButton } from "@cn/ui/IconButton";

/** The pill near the bottom of the window that tells a reader who has not
 *  reached any note yet how many the page has, and takes them to the first.
 *  It sits 80 px up. Lower down it covered Substack's own controls: the like,
 *  comment and share bar on phones, and the buttons of the cookie banner. It
 *  never wraps, because a centred fixed box only gets half the window's width
 *  before it breaks lines, which made it two lines tall on phones. */
export function NotesAheadPill({ count, onJump, onDismiss }: { count: number; onJump: () => void; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className={cn(cardVariants({ elevation: "floating" }), "fixed bottom-20 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full py-1 pl-3 pr-1")}
    >
      <button type="button" className={cn("flex items-center gap-2 text-sm font-medium text-fg", focusRing)} onClick={onJump}>
        <NoteStackIcon size={14} />
        {count === 1 ? "1 note on this page" : `${count} notes on this page`} ↓
      </button>
      <IconButton label="Dismiss" onClick={onDismiss}>
        <CloseIcon size={14} aria-hidden />
      </IconButton>
    </div>
  );
}
