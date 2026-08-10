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

const VOTE_OPTIONS: { value: VoteValue; label: string; active: string; idle: string }[] = [
  { value: 1, label: "Helpful", active: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700", idle: "text-green-700 border-gray-200 hover:bg-green-50 dark:text-green-400 dark:border-gray-600 dark:hover:bg-green-950/40" },
  { value: 0, label: "Somewhat helpful", active: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700", idle: "text-amber-700 border-gray-200 hover:bg-amber-50 dark:text-amber-400 dark:border-gray-600 dark:hover:bg-amber-950/40" },
  { value: -1, label: "Not helpful", active: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/50 dark:text-red-300 dark:border-red-700", idle: "text-red-700 border-gray-200 hover:bg-red-50 dark:text-red-400 dark:border-gray-600 dark:hover:bg-red-950/40" },
];

/** Every vote value, in the order the pills are drawn. Callers that have to walk
 *  all three values, such as scoring each option or ranking a feed, use this
 *  instead of writing the literals out again. */
export const VOTE_VALUES: readonly VoteValue[] = VOTE_OPTIONS.map((o) => o.value);

export function VoteRatings({ helpful, somewhatHelpful, notHelpful, myVote, onVote, showCounts = myVote !== undefined }: {
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
}) {
  const counts: Record<VoteValue, number> = { 1: helpful, 0: somewhatHelpful, [-1]: notHelpful };
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {VOTE_OPTIONS.map(({ value, label, active, idle }) => (
        <button
          key={value}
          type="button"
          aria-pressed={myVote === value}
          aria-label={showCounts ? `${label}: ${counts[value]} ratings` : label}
          onClick={() => onVote(value)}
          className={`text-xs px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${myVote === value ? active : idle}`}
        >
          {label}
          {showCounts && counts[value] > 0 && <span className="ml-1 font-semibold">{counts[value].toLocaleString("en-US")}</span>}
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
