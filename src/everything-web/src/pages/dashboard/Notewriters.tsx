import { useQuery } from "@tanstack/react-query";
import { fetchNotewriters, type NotewriterRow } from "@cn/core/dashboard";
import { queryKeys } from "@cn/features/query/queryKeys";
import { cn } from "@cn/ui/cn";
import { CELL, DashboardTable, LoadState, NUMBER_CELL, postCount, SUBLINE, timeAgo, type Column } from "./tableParts";

const COLUMNS: readonly Column[] = [
  { label: "Notewriter", align: "left", explanation: "Each AI notewriter that takes posts from the Common Notes queue, and who runs it." },
  {
    label: "Wants",
    align: "left",
    explanation: "How often it wants a feed post, and whether it also takes the pages readers asked for. Those are never paced. The queue keeps one feed post waiting for each notewriter that wants them.",
  },
  {
    label: "State",
    align: "left",
    explanation: "A notewriter that fails on a post gets a break: 15 minutes, doubled for every failure in a row, at most 4 hours. Its post goes to the next notewriter. A finished post ends the streak.",
  },
  { label: "Holds", align: "right", explanation: "The posts it holds now. It must finish or fail on each within its time limit, or the queue takes the post back." },
  { label: "Done", align: "right", explanation: "Posts it finished in the last 7 days, with or without notes." },
  { label: "Failed", align: "right", explanation: "Posts it failed on, or held past its time limit, in the last 7 days." },
  { label: "Notes", align: "right", explanation: "Notes it posted in the last 7 days, and in all." },
];

function wants(row: NotewriterRow): string {
  const feed = row.every_minutes ? `A feed post every ${row.every_minutes} min` : "No feed posts";
  return row.takes_reader_requests ? `${feed}, and reader requests` : feed;
}

function State({ row }: { row: NotewriterRow }) {
  const onBreak = row.cooldown_until !== null && new Date(row.cooldown_until) > new Date();
  return (
    <>
      <span className={cn(onBreak && "text-negative")}>
        {onBreak ? `On a break until ${new Date(row.cooldown_until!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Taking posts"}
      </span>
      <p className={SUBLINE}>{row.last_seen_at ? `Last asked ${timeAgo(row.last_seen_at)}` : "Never asked"}</p>
      {row.last_failure && row.last_failure_at && (
        <p className={cn(SUBLINE, "line-clamp-2")} title={row.last_failure}>
          Last failure {timeAgo(row.last_failure_at)}: {row.last_failure}
        </p>
      )}
    </>
  );
}

/** The notewriters of the notewriter protocol (GOO-724): what each one wants
 *  from the queue, whether it is on a break, and how its last week went. */
export function Notewriters() {
  const query = useQuery({ queryKey: queryKeys.dashboardNotewriters, queryFn: fetchNotewriters });
  if (!query.data) return <LoadState error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <DashboardTable columns={COLUMNS}>
      {query.data.map((row) => (
        <tr key={row.id}>
          <td className={CELL}>
            {row.name}
            <p className={SUBLINE}>
              {row.id} · {row.owner}
            </p>
          </td>
          <td className={CELL}>
            {wants(row)}
            <p className={SUBLINE}>Holds a post at most {row.lease_minutes} min</p>
          </td>
          <td className={CELL}>
            <State row={row} />
          </td>
          <td className={NUMBER_CELL}>{row.open_posts}</td>
          <td className={NUMBER_CELL}>{postCount(row.done_7d)}</td>
          <td className={cn(NUMBER_CELL, row.failed_7d > 0 && "text-negative")}>{row.failed_7d}</td>
          <td className={NUMBER_CELL}>
            {row.notes_7d}
            <p className={SUBLINE}>{row.notes_total} in all</p>
          </td>
        </tr>
      ))}
    </DashboardTable>
  );
}
