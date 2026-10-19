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
