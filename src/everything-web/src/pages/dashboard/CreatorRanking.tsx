import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCreatorRanking, type CreatorRankingRow } from "@cn/core/dashboard";
import {
  byWalkOrder,
  creatorScore,
  IMAGINED_AVERAGE_POSTS,
  IMAGINED_UNREAD_POSTS,
  LAST_POSTS_PER_CREATOR,
} from "@cn/core/readers";
import { queryKeys } from "@cn/features/query/queryKeys";
import { cn } from "@cn/ui/cn";
import { ExternalLinkIcon } from "@cn/ui/icons";
import { RouteLink } from "../../components/RouteLink";
import type { Route } from "../../lib/routing";
import { CELL, DashboardTable, LoadState, NUMBER_CELL, postCount, ShowMore, SUBLINE, type Column } from "./tableParts";

const CREATORS_PER_STEP = 25;
const HOURS_SHOWN_AS_HOURS = 48;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const COLUMNS: readonly Column[] = [
  {
    label: "#",
    align: "right",
    explanation: "The creator's place in the order the next walk will go through, computed when this page loaded. Creators who hold priority come first, then the highest score.",
  },
  { label: "Creator", align: "left", explanation: "The creator, and until when they hold priority. The arrow opens their feed." },
  {
    label: "Score",
    align: "right",
    explanation: `The average number of different people per post, over the creator's ${LAST_POSTS_PER_CREATOR} most recently visited posts. It also counts ${IMAGINED_UNREAD_POSTS} imagined posts that nobody read and ${IMAGINED_AVERAGE_POSTS} with the average readers per post, so a creator with few visited posts cannot top the walk. Below it is the plain average without the imagined posts.`,
  },
  {
    label: "Median delay",
    align: "right",
    explanation: `The median time from the moment a post was published to the end of its first check, over the creator's ${LAST_POSTS_PER_CREATOR} most recently published new posts we checked. A later re-check does not count. Only posts published after the walk first took a post of the creator count, so the older posts the first walk catches up on and the most popular posts of all time are left out. Posts taken before 23 October 2026 count only when we could look up their exact publication time.`,
  },
  {
    label: "Vote rate",
    align: "right",
    explanation: `The people who voted in the extension on a post's notes, divided by the people who opened the post after its first note appeared. It is summed over the creator's ${LAST_POSTS_PER_CREATOR} most recently visited posts with notes. Votes by admins are left out. The two sides cannot be matched person to person, so the rate is a ratio of counts.`,
  },
];

/** "40 min" under an hour, "19 h" under two days, "6.7 days" above. */
function formatDelay(hours: number): string {
  if (hours < 1) return `${Math.round(hours * MINUTES_PER_HOUR)} min`;
  if (hours < HOURS_SHOWN_AS_HOURS) return `${Math.round(hours)} h`;
  return `${(hours / HOURS_PER_DAY).toFixed(1)} days`;
}

/** The same score the walk ranks on, with the average the database computed. */
const walkScore = (row: CreatorRankingRow) =>
  creatorScore({ visitors_per_post: row.visitors_per_post ?? 0, posts: row.score_posts ?? 0 }, row.average_readers_per_post);

/** The walk's comparator needs the score of a prioritised creator nobody
 *  visited as zero, the same value the walk itself uses for them. */
const walkOrderKey = (row: CreatorRankingRow) => ({
  prioritized: row.priority_until !== null,
  feed_url: row.feed_url,
  walkScore: walkScore(row),
  score: { people: row.people ?? 0 },
});

const inWalkOrder = (rows: CreatorRankingRow[]) => rows.toSorted((a, b) => byWalkOrder(walkOrderKey(a), walkOrderKey(b)));

const shortFeedUrl = (feedUrl: string) => feedUrl.replace(/^https?:\/\/(www\.)?/, "");

/** The creator's name links to their project on the site. A creator walked on
 *  visits alone may have no project yet, and then their feed address stands
 *  in for the name. */
function CreatorCell({ row, navigate }: { row: CreatorRankingRow; navigate: (route: Route) => void }) {
  const name = row.project_name ?? shortFeedUrl(row.feed_url);
  return (
    <td className={cn(CELL, "min-w-52")}>
      <span className="inline-flex items-center gap-1.5">
        {row.project_slug ? (
          <RouteLink to={{ view: "notes", project: row.project_slug, item: null, note: null }} navigate={navigate} className="font-medium text-fg hover:underline">
            {name}
          </RouteLink>
        ) : (
          <span className="font-medium text-fg">{name}</span>
        )}
        <a href={row.feed_url} target="_blank" rel="noreferrer" aria-label={`Open the feed of ${name}`} className="text-fg-subtle hover:text-fg">
          <ExternalLinkIcon size={14} />
        </a>
      </span>
      {row.priority_until && (
        <div className={SUBLINE}>Priority until {new Date(row.priority_until).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>
      )}
    </td>
  );
}

function ScoreCell({ row }: { row: CreatorRankingRow }) {
  if (row.visitors_per_post === null || row.score_posts === null) return <td className={NUMBER_CELL}>—</td>;
  return (
    <td className={NUMBER_CELL}>
      {walkScore(row).toFixed(2)}
      <div className={SUBLINE}>
        {row.visitors_per_post.toFixed(2)} per post, {postCount(row.score_posts)}
      </div>
    </td>
  );
}

function DelayCell({ row }: { row: CreatorRankingRow }) {
  if (row.median_delay_hours === null || row.delay_posts === null) return <td className={NUMBER_CELL}>—</td>;
  return (
    <td className={NUMBER_CELL}>
      {formatDelay(row.median_delay_hours)}
      <div className={SUBLINE}>{postCount(row.delay_posts)}</div>
    </td>
  );
}

function VoteRateCell({ row }: { row: CreatorRankingRow }) {
  if (!row.vote_visitors || row.extension_voters === null || row.vote_posts === null) return <td className={NUMBER_CELL}>—</td>;
  return (
    <td className={NUMBER_CELL}>
      {Math.round((100 * row.extension_voters) / row.vote_visitors)}%
      <div className={SUBLINE}>
        {row.extension_voters} of {row.vote_visitors}, {postCount(row.vote_posts)}
      </div>
    </td>
  );
}

/** The creators the walk would go through if it ran now, in its order, with
 *  how widely each is read, how fast we check their posts, and how often their
 *  readers vote. */
export function CreatorRanking({ navigate }: { navigate: (route: Route) => void }) {
  const query = useQuery({ queryKey: queryKeys.dashboardCreatorRanking, queryFn: fetchCreatorRanking, select: inWalkOrder });
  const [shown, setShown] = useState(CREATORS_PER_STEP);
  const rows = query.data;

  if (!rows) return <LoadState error={query.error} onRetry={() => void query.refetch()} />;
  if (rows.length === 0) return <p className="text-sm text-fg-muted">No creator holds priority or reaches the walk's score.</p>;
  return (
    <>
      <DashboardTable columns={COLUMNS}>
        {rows.slice(0, shown).map((row, i) => (
          <tr key={row.feed_url}>
            <td className={cn(NUMBER_CELL, "text-fg-muted")}>{i + 1}</td>
            <CreatorCell row={row} navigate={navigate} />
            <ScoreCell row={row} />
            <DelayCell row={row} />
            <VoteRateCell row={row} />
          </tr>
        ))}
      </DashboardTable>
      <ShowMore shown={shown} total={rows.length} step={CREATORS_PER_STEP} onMore={() => setShown((n) => n + CREATORS_PER_STEP)} />
    </>
  );
}
