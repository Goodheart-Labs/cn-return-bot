import { useContext } from "react";
import { cva } from "class-variance-authority";
import type { Vote } from "@cn/core/votes";
import { CheckIcon, CloseIcon, WaveIcon } from "@cn/ui/icons";
import { PillPaletteContext } from "./pillPalette";

/* The pills answer the question "Is this note helpful?", so they read Yes,
 * Somewhat and No, as on X's Community Notes. The full pills sit in the note's
 * rating panel. The compact icon chips rate note-not-needed entries, where an
 * icon without a label would read as pressed if it were coloured, so they stay
 * grey until chosen in either palette. */
const votePillVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-full border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
  {
    variants: {
      size: {
        full: "h-9 px-4 text-sm [@media(pointer:coarse)]:min-h-10",
        compact: "h-6 w-7 text-xs [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:w-10",
      },
      palette: { neutral: "", colourful: "" },
      tone: { positive: "", caution: "", negative: "" },
      selected: { true: "", false: "" },
    },
    compoundVariants: [
      // An unchosen pill has no fill of its own. It shows the rating panel's
      // colour inside its border, as the rating buttons on X do.
      { size: "full", palette: "neutral", selected: false, className: "border-line-strong text-link hover:bg-surface-hover" },
      // Colourful pills wait with a grey border and coloured text, and fill with
      // their colour only once chosen, so the card stays calm until a vote.
      { size: "full", palette: "colourful", tone: "positive", selected: false, className: "border-line-strong text-positive hover:bg-positive-soft" },
      { size: "full", palette: "colourful", tone: "caution", selected: false, className: "border-line-strong text-caution hover:bg-caution-soft" },
      { size: "full", palette: "colourful", tone: "negative", selected: false, className: "border-line-strong text-negative hover:bg-negative-soft" },
      { size: "compact", selected: false, className: "border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg" },
      { palette: "neutral", selected: true, className: "border-primary bg-primary text-on-primary" },
      { palette: "colourful", tone: "positive", selected: true, className: "border-positive bg-positive text-white" },
      { palette: "colourful", tone: "caution", selected: true, className: "border-caution bg-caution text-white" },
      { palette: "colourful", tone: "negative", selected: true, className: "border-negative bg-negative text-white" },
    ],
  },
);

const VOTE_ICON_SIZE = 12;

const VOTE_OPTIONS = [
  { value: 1, label: "Yes", meaning: "Helpful", tone: "positive", icon: <CheckIcon size={VOTE_ICON_SIZE} aria-hidden /> },
  { value: 0, label: "Somewhat", meaning: "Somewhat helpful", tone: "caution", icon: <WaveIcon size={VOTE_ICON_SIZE} aria-hidden /> },
  { value: -1, label: "No", meaning: "Not helpful", tone: "negative", icon: <CloseIcon size={VOTE_ICON_SIZE} aria-hidden /> },
] as const satisfies readonly { value: Vote; label: string; meaning: string; tone: string; icon: React.ReactNode }[];

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
   *  surfaces such as note-not-needed entries. The meaning moves into the
   *  tooltip and the aria label. Both variants share one style table, so the
   *  two cannot drift apart again. */
  compact?: boolean;
}) {
  const palette = useContext(PillPaletteContext);
  const counts: Record<Vote, number> = { 1: helpful, 0: somewhatHelpful, [-1]: notHelpful };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {VOTE_OPTIONS.map(({ value, label, meaning, tone, icon }) => (
        <button
          key={value}
          type="button"
          title={compact ? meaning : undefined}
          aria-pressed={myVote === value}
          // "Yes" and "No" alone would be ambiguous to a screen reader that
          // reaches the pills without the question, so the name says both.
          aria-label={showCounts ? `${label}, ${meaning.toLowerCase()}: ${counts[value]} ratings` : `${label}, ${meaning.toLowerCase()}`}
          onClick={() => onVote(value)}
          className={votePillVariants({ size: compact ? "compact" : "full", palette, tone, selected: myVote === value })}
        >
          {compact ? icon : label}
          {showCounts && counts[value] > 0 && <span className="tabular-nums">{counts[value].toLocaleString("en-US")}</span>}
        </button>
      ))}
    </span>
  );
}
