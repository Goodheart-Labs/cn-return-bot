import { CHIP } from "@cn/ui/classes";
import type { Vote } from "@cn/core/votes";

const VOTE_ICON_PROPS = {
  width: 12, height: 12, viewBox: "0 0 14 14",
  fill: "none", stroke: "currentColor", strokeWidth: 1.8,
  strokeLinecap: "round", strokeLinejoin: "round",
} as const;

/* The main pills are coloured by their own meaning even when unselected, with
 * the chosen option set apart by its filled background. Jim prefers this look
 * (2026-08-30); a grey-until-chosen variant was tried and rolled back. The
 * compact icon chips keep grey idles, because an icon-only chip has no label
 * to carry the colour and reads as pressed otherwise. */
const VOTE_OPTIONS: { value: Vote; label: string; active: string; idle: string; hover: string; icon: React.ReactNode }[] = [
  {
    value: 1, label: "Helpful",
    active: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700",
    idle: "text-green-700 border-gray-200 hover:bg-green-50 dark:text-green-400 dark:border-gray-600 dark:hover:bg-green-950/40",
    hover: "hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950/40 dark:hover:text-green-400",
    icon: <svg {...VOTE_ICON_PROPS} aria-hidden><path d="M3.5 8.5l3 3 6-7" /></svg>,
  },
  {
    value: 0, label: "Somewhat helpful",
    active: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700",
    idle: "text-amber-700 border-gray-200 hover:bg-amber-50 dark:text-amber-400 dark:border-gray-600 dark:hover:bg-amber-950/40",
    hover: "hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/40 dark:hover:text-amber-400",
    icon: <svg {...VOTE_ICON_PROPS} aria-hidden><path d="M2.5 9c1.8-2.6 3.7-2.6 5.5 0s3.7 2.6 5.5 0" /></svg>,
  },
  {
    value: -1, label: "Not helpful",
    active: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/50 dark:text-red-300 dark:border-red-700",
    idle: "text-red-700 border-gray-200 hover:bg-red-50 dark:text-red-400 dark:border-gray-600 dark:hover:bg-red-950/40",
    hover: "hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-400",
    icon: <svg {...VOTE_ICON_PROPS} aria-hidden><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>,
  },
];

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
  const shape = `${CHIP} transition-colors`;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {VOTE_OPTIONS.map(({ value, label, active, idle, hover, icon }) => (
        <button
          key={value}
          type="button"
          title={compact ? label : undefined}
          aria-pressed={myVote === value}
          aria-label={showCounts ? `${label}: ${counts[value]} ratings` : label}
          onClick={() => onVote(value)}
          className={`${shape} ${myVote === value ? active : compact ? `border-transparent text-gray-400 dark:text-gray-500 ${hover}` : idle}`}
        >
          {compact ? icon : label}
          {showCounts && counts[value] > 0 && <span>{counts[value].toLocaleString("en-US")}</span>}
        </button>
      ))}
    </span>
  );
}
