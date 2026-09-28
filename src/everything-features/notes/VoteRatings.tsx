import { cva } from "class-variance-authority";
import type { Vote } from "@cn/core/votes";
import { chipVariants } from "@cn/ui/Chip";
import { CheckIcon, CloseIcon, WaveIcon } from "@cn/ui/icons";

/* The main pills are coloured by their own meaning even when unselected, with
 * the chosen option set apart by its filled background. Jim prefers this look
 * (2026-08-30); a grey-until-chosen variant was tried and rolled back. The
 * compact icon chips keep grey idles, because an icon-only chip has no label
 * to carry the colour and reads as pressed otherwise. */
const votePillVariants = cva(chipVariants(), {
  variants: {
    tone: { positive: "", caution: "", negative: "" },
    state: { selected: "", idle: "border-line", compact: "border-transparent text-fg-subtle" },
  },
  compoundVariants: [
    { tone: "positive", state: "selected", className: "bg-positive-selected text-positive-selected-fg border-positive-line" },
    { tone: "caution", state: "selected", className: "bg-caution-selected text-caution-selected-fg border-caution-line" },
    { tone: "negative", state: "selected", className: "bg-negative-selected text-negative-selected-fg border-negative-line" },
    { tone: "positive", state: ["idle", "compact"], className: "hover:bg-positive-soft hover:text-positive" },
    { tone: "caution", state: ["idle", "compact"], className: "hover:bg-caution-soft hover:text-caution" },
    { tone: "negative", state: ["idle", "compact"], className: "hover:bg-negative-soft hover:text-negative" },
    { tone: "positive", state: "idle", className: "text-positive" },
    { tone: "caution", state: "idle", className: "text-caution" },
    { tone: "negative", state: "idle", className: "text-negative" },
  ],
});

const VOTE_ICON_SIZE = 12;

const VOTE_OPTIONS = [
  { value: 1, label: "Helpful", tone: "positive", icon: <CheckIcon size={VOTE_ICON_SIZE} aria-hidden /> },
  { value: 0, label: "Somewhat helpful", tone: "caution", icon: <WaveIcon size={VOTE_ICON_SIZE} aria-hidden /> },
  { value: -1, label: "Not helpful", tone: "negative", icon: <CloseIcon size={VOTE_ICON_SIZE} aria-hidden /> },
] as const satisfies readonly { value: Vote; label: string; tone: string; icon: React.ReactNode }[];

/** The three rating pills under a note. Common Notes uses X's three-way rating
 *  scale, so a rating is helpful, somewhat helpful, or not helpful. A
 *  somewhat-helpful rating counts half as much when the note is scored.
 *  Clicking a pill casts a vote, and the highlighted pill is the viewer's own
 *  vote. The pills render even when every count is zero, because somebody has
 *  to be able to cast the first vote. */
export function VoteRatings({ helpful, somewhatHelpful, notHelpful, myVote, onVote, showCounts = myVote !== undefined, compact = false }: {
  helpful: number;
  somewhatHelpful: number;
  notHelpful: number;
  myVote?: Vote;
  onVote: (vote: Vote) => void;
  /** Tallies stay hidden until the viewer has cast their own vote, so the crowd
   *  cannot anchor them. The aria labels drop the counts too, so a screen reader
   *  does not leak them either. Callers can widen the rule, for example to show
   *  the counts on old notes. */
  showCounts?: boolean;
  /** The compact variant shrinks the pills to icon chips for secondary
   *  surfaces such as note-not-needed entries. The written labels move into
   *  the tooltip and the aria label. Both variants share one style table, so
   *  the two cannot drift apart again. */
  compact?: boolean;
}) {
  const counts: Record<Vote, number> = { 1: helpful, 0: somewhatHelpful, [-1]: notHelpful };
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {VOTE_OPTIONS.map(({ value, label, tone, icon }) => (
        <button
          key={value}
          type="button"
          title={compact ? label : undefined}
          aria-pressed={myVote === value}
          aria-label={showCounts ? `${label}: ${counts[value]} ratings` : label}
          onClick={() => onVote(value)}
          className={votePillVariants({ tone, state: myVote === value ? "selected" : compact ? "compact" : "idle" })}
        >
          {compact ? icon : label}
          {showCounts && counts[value] > 0 && <span>{counts[value].toLocaleString("en-US")}</span>}
        </button>
      ))}
    </span>
  );
}
