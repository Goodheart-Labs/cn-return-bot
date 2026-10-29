import { useState } from "react";
import type { XNote } from "@cn/core/notewriter";
import { RatingPanel, StatusBadge } from "@cn/features/notes/NoteBox";
import { Card } from "@cn/ui/Card";
import { chipVariants } from "@cn/ui/Chip";
import { cn } from "@cn/ui/cn";
import { communityNoteUrl } from "../../../../dashboard-shared/communityNoteUrl";
import { LinkifiedText } from "../../../../dashboard-shared/LinkifiedText";
import { humanizeTagName } from "@cn/core/ratingReasons";
import { XPostCard } from "./XPostCard";

type Ratings = NonNullable<XNote["ratings"]>;
type Side = "helpful" | "notHelpful";

const SIDES = {
  helpful: { label: "Helpful", tone: "border-transparent bg-positive-selected text-positive-selected-fg" },
  notHelpful: { label: "Not helpful", tone: "border-transparent bg-negative-selected text-negative-selected-fg" },
} as const;

const formatViews = (views: number) =>
  views >= 1_000_000 ? `${(views / 1_000_000).toFixed(1)}M` : views >= 1_000 ? `${(views / 1_000).toFixed(1)}K` : String(views);

/** The ratings X's raters gave, read-only, as the website's rating pills look
 *  once chosen. A click on Helpful or Not helpful lists the reasons the raters
 *  of that side gave. A second click closes the list. Somewhat helpful counts
 *  as helpful on X and has no reasons of its own. */
function XRatings({ ratings }: { ratings: Ratings }) {
  const [open, setOpen] = useState<Side | null>(null);
  const reasons = open === "helpful" ? ratings.helpfulReasons : open === "notHelpful" ? ratings.notHelpfulReasons : {};
  const counts: Record<Side, number> = { helpful: ratings.helpful, notHelpful: ratings.notHelpful };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["helpful", "notHelpful"] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-expanded={open === side}
            onClick={() => setOpen(open === side ? null : side)}
            className={cn(chipVariants(), SIDES[side].tone, open === side && "ring-2 ring-focus")}
          >
            {SIDES[side].label} {counts[side]}
          </button>
        ))}
        {ratings.somewhatHelpful > 0 && <span className={cn(chipVariants(), "border-transparent bg-caution-selected text-caution-selected-fg")}>Somewhat {ratings.somewhatHelpful}</span>}
      </div>
      {open && (
        <ul className="flex flex-wrap gap-1.5">
          {Object.entries(reasons)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => (
              <li key={reason} className={cn(chipVariants(), "border-line font-medium text-fg-secondary")}>
                {humanizeTagName(reason)} <span className="font-semibold">{count}</span>
              </li>
            ))}
          {Object.values(reasons).every((count) => count === 0) && <li className="text-xs text-fg-muted">The raters gave no reasons.</li>}
        </ul>
      )}
    </div>
  );
}

/** One of our notes on X in the website's note style: the post on top, where
 *  the website's cards show the quoted passage, then the note with X's status
 *  line, and the ratings from X's public data. */
export function XNoteCard({ note }: { note: XNote }) {
  const written = new Date(note.written).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <Card className="mx-auto w-full max-w-[40rem] p-4">
      {note.post && (
        <div className="mb-4">
          <XPostCard post={note.post} />
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <StatusBadge status={note.status} />
        <span className="shrink-0 text-xs text-fg-muted">
          Written {written}
          {note.views > 0 && ` · ${formatViews(note.views)} views`}
        </span>
      </div>
      <LinkifiedText className="text-sm text-fg whitespace-pre-wrap [overflow-wrap:anywhere]" linkClassName="text-link hover:underline break-all" text={note.noteText} />
      <RatingPanel
        question={
          <a href={communityNoteUrl(note.noteId)} target="_blank" rel="noreferrer" className="font-semibold text-link hover:underline">
            The note on X ↗
          </a>
        }
      >
        {note.ratings ? <XRatings ratings={note.ratings} /> : <span className="text-xs text-fg-muted">No ratings in X's public data yet</span>}
      </RatingPanel>
    </Card>
  );
}
