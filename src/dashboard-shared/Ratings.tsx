import { useState } from "react";
import type { PublicDumpRatings } from "./types";
import { humanizeTagName } from "./ratingReasons";

type TagBucket = "helpful" | "not_helpful";

interface Props {
  // Data taken from X's public ratings dump. It is the only source we have for
  // how the rating tags are distributed.
  publicDumpRatings: PublicDumpRatings | null | undefined;
  // Counts to fall back on when there is no public-dump data, for example the
  // counts scraped from the notewriter page. Those counts carry no tags, so the
  // buttons stop expanding when they are used.
  fallbackHelpfulCount?: number | null;
  fallbackNotHelpfulCount?: number | null;
  // When this is false the buttons still render but clicking them does nothing,
  // so no tags are shown. Use it to hide tag-level data on a deployed dashboard
  // while keeping the counts visible. It defaults to true.
  allowExpand?: boolean;
}

// Works out the counts the badge shows. The public-dump numbers win, and the
// scraped fallback counts are used when there are none. This is exported so a
// caller can ask "does this note have ratings?" by the same rule the badge uses.
// A note has ratings when helpful plus notHelpful is above zero.
export function resolveRatingCounts(
  publicDumpRatings: PublicDumpRatings | null | undefined,
  fallbackHelpfulCount?: number | null,
  fallbackNotHelpfulCount?: number | null,
): { helpful: number; notHelpful: number } {
  return {
    helpful: publicDumpRatings?.helpful_count ?? fallbackHelpfulCount ?? 0,
    notHelpful: publicDumpRatings?.not_helpful_count ?? fallbackNotHelpfulCount ?? 0,
  };
}

export function Ratings({
  publicDumpRatings,
  fallbackHelpfulCount,
  fallbackNotHelpfulCount,
  allowExpand = true,
}: Props) {
  const [openBucket, setOpenBucket] = useState<TagBucket | null>(null);
  const { helpful, notHelpful } = resolveRatingCounts(publicDumpRatings, fallbackHelpfulCount, fallbackNotHelpfulCount);
  if (helpful + notHelpful === 0) return null;

  const canExpand = allowExpand && !!publicDumpRatings;
  const toggle = (b: TagBucket) => setOpenBucket((cur) => (cur === b ? null : b));

  return (
    <>
      <span className="text-xs text-gray-500 inline-flex items-center gap-1">
        {helpful > 0 && (
          <RatingButton
            bucket="helpful"
            count={helpful}
            active={openBucket === "helpful"}
            disabled={!canExpand}
            onClick={() => toggle("helpful")}
          />
        )}
        {helpful > 0 && notHelpful > 0 && <span aria-hidden>·</span>}
        {notHelpful > 0 && (
          <RatingButton
            bucket="not_helpful"
            count={notHelpful}
            active={openBucket === "not_helpful"}
            disabled={!canExpand}
            onClick={() => toggle("not_helpful")}
          />
        )}
      </span>
      {canExpand && openBucket && publicDumpRatings && (
        <TagPills ratings={publicDumpRatings} bucket={openBucket} />
      )}
    </>
  );
}

/** The interactive twin of Ratings. It draws labelled pills instead of the ▲ and
 *  ▼ arrows. Common Notes uses X's three-way rating scale, so a rating is either
 *  helpful, somewhat helpful, or not helpful. A somewhat-helpful rating counts
 *  half as much when the note is scored. Clicking a pill casts a vote, and the
 *  highlighted pill is the viewer's own vote. The dashboards keep the
 *  display-only Ratings instead. Unlike Ratings this still renders when every
 *  count is zero, because somebody has to be able to cast the first vote. */
export type VoteValue = 1 | 0 | -1;

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
const VOTE_OPTIONS: { value: VoteValue; label: string; active: string; idle: string; hover: string; icon: React.ReactNode }[] = [
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

/** Every vote value, in the order the pills are drawn. Callers that have to walk
 *  all three values, such as scoring each option or ranking a feed, use this
 *  instead of writing the literals out again. */
export const VOTE_VALUES: readonly VoteValue[] = VOTE_OPTIONS.map((o) => o.value);

export function VoteRatings({ helpful, somewhatHelpful, notHelpful, myVote, onVote, showCounts = myVote !== undefined, compact = false }: {
  helpful: number;
  somewhatHelpful: number;
  notHelpful: number;
  myVote?: VoteValue;
  onVote: (vote: VoteValue) => void;
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
  const counts: Record<VoteValue, number> = { 1: helpful, 0: somewhatHelpful, [-1]: notHelpful };
  const shape = compact
    ? "inline-flex items-center gap-1 h-6 px-1.5 rounded-full border text-[11px] font-semibold transition-colors"
    : "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border cursor-pointer transition-colors";
  return (
    <span className={compact ? "inline-flex items-center gap-0.5" : "inline-flex items-center gap-1.5 flex-wrap"}>
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
          {showCounts && counts[value] > 0 && <span className={compact ? "" : "ml-0.5 font-semibold"}>{counts[value].toLocaleString("en-US")}</span>}
        </button>
      ))}
    </span>
  );
}

function RatingButton({
  bucket,
  count,
  active,
  disabled,
  onClick,
}: {
  bucket: TagBucket;
  count: number;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const base = "px-1.5 py-0.5 rounded transition-colors inline-flex items-center gap-1";
  const interactive = disabled
    ? "cursor-default text-gray-500"
    : "cursor-pointer hover:bg-gray-100 text-gray-700";
  const activeClass = active ? "bg-gray-200 text-gray-900" : "";
  const color = bucket === "helpful" ? "text-green-600" : "text-red-600";
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${bucket === "helpful" ? "Helpful" : "Not helpful"} ratings: ${count}`}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${interactive} ${activeClass}`.trim()}
    >
      <span className={`${color} leading-none`.trim()}>{bucket === "helpful" ? "▲" : "▼"}</span>
      {count.toLocaleString("en-US")}
    </button>
  );
}

function TagPills({ ratings, bucket }: { ratings: PublicDumpRatings; bucket: TagBucket }) {
  const counts = bucket === "helpful" ? ratings.helpful_tag_counts : ratings.not_helpful_tag_counts;
  const entries = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <div className="mt-2 text-xs text-gray-500 italic">No tag annotations.</div>;
  }
  const pillClass = bucket === "helpful"
    ? "bg-green-50 text-green-800 border-green-200"
    : "bg-red-50 text-red-800 border-red-200";
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.map(([tag, count]) => (
        <span key={tag} className={`text-xs px-2 py-0.5 rounded-full border ${pillClass}`}>
          {humanizeTagName(tag)}
          <span className="ml-1 font-semibold">{count}</span>
        </span>
      ))}
    </div>
  );
}
