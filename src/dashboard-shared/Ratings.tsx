import { useState } from "react";
import type { PublicDumpRatings } from "./types";
import { humanizeTagName } from "./ratingReasons";

type TagBucket = "helpful" | "not_helpful";

interface Props {
  // Public-dump-derived data; carries the only source of tag distribution.
  publicDumpRatings: PublicDumpRatings | null | undefined;
  // Optional fallback when public-dump data is missing (e.g. scraped
  // notewriter counts). Click-to-reveal is auto-disabled in that case.
  fallbackHelpfulCount?: number | null;
  fallbackNotHelpfulCount?: number | null;
  // If false, the buttons render but are inert (no tag expansion). Use this
  // to hide tag-level data on a deployed dashboard while keeping the counts
  // visible. Defaults to true.
  allowExpand?: boolean;
}

// The counts the badge shows — public-dump first, scraped fallback otherwise.
// Exported so callers can ask "does this note have ratings?" with the exact rule
// the badge uses: a note has ratings iff helpful + notHelpful > 0.
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

/** Interactive twin of Ratings: labeled pills instead of ▲/▼ — Common Notes
 *  uses X's three-way rating scale (helpful / somewhat helpful / not helpful;
 *  somewhat carries 0.5 weight at scoring time). Clicking casts a vote, active
 *  = the viewer's own vote. The dashboards keep the display-only Ratings;
 *  unlike Ratings this renders at zero counts — you must be able to cast the
 *  first vote. */
export type VoteValue = 1 | 0 | -1;

const VOTE_OPTIONS: { value: VoteValue; label: string; active: string; idle: string }[] = [
  { value: 1, label: "Helpful", active: "bg-green-100 text-green-800 border-green-300", idle: "text-green-700 border-gray-200 hover:bg-green-50" },
  { value: 0, label: "Somewhat helpful", active: "bg-amber-100 text-amber-800 border-amber-300", idle: "text-amber-700 border-gray-200 hover:bg-amber-50" },
  { value: -1, label: "Not helpful", active: "bg-red-100 text-red-800 border-red-300", idle: "text-red-700 border-gray-200 hover:bg-red-50" },
];

export function VoteRatings({ helpful, somewhatHelpful, notHelpful, myVote, onVote }: {
  helpful: number;
  somewhatHelpful: number;
  notHelpful: number;
  myVote?: VoteValue;
  onVote: (vote: VoteValue) => void;
}) {
  const counts: Record<VoteValue, number> = { 1: helpful, 0: somewhatHelpful, [-1]: notHelpful };
  // Tallies stay hidden until the viewer has cast their own vote, so the
  // crowd doesn't anchor it (aria included — no leaking via screen reader).
  const showCounts = myVote !== undefined;
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
