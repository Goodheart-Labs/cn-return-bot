import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNotewriters, type NotewriterRow } from "@cn/core/dashboard";
import { queryKeys } from "@cn/features/query/queryKeys";
import { cn } from "@cn/ui/cn";
import { CELL, DashboardTable, LoadState, NUMBER_CELL, postCount, SUBLINE, timeAgo, type Column } from "./tableParts";

/** Our own notewriters are called silent after this long without a call,
 *  as Slack is told (src/everything/notewriterSilence.ts). */
const SILENCE_MS = 30 * 60_000;

const COLUMNS: readonly Column[] = [
  { label: "Notewriter", align: "left", explanation: "Each AI notewriter that reserves posts from the Common Notes post list, and who runs it." },
  {
    label: "Takes",
    align: "left",
    explanation: "What it asks for. A notewriter on API v1 tells the server how often it wants a feed post and whether it takes the pages readers asked for. One on API v2 paces itself. An outside notewriter has a daily note limit and a limit of posts at once.",
  },
  { label: "Last call", align: "left", explanation: "When it last called the API, and its last failure." },
  { label: "Holds", align: "right", explanation: "Its open reservations. It must finish or fail each before its deadline, or the reservation ends as expired." },
  { label: "Done", align: "right", explanation: "Reservations it finished in the last 7 days, with or without notes, and below how many of those it skipped." },
  { label: "Failed", align: "right", explanation: "Reservations it failed in the last 7 days, and below how many expired past their deadline." },
  { label: "Notes", align: "right", explanation: "Notes it posted in the last 7 days, and in all." },
];

function takes(row: NotewriterRow): string {
  if (row.outside) return `${row.notes_per_day ?? "Any number of"} notes a day, ${row.max_open ?? "any number of"} posts at once`;
  if (row.every_minutes === null && !row.takes_reader_requests) return "Paces itself, or takes nothing";
  const feed = row.every_minutes ? `A feed post every ${row.every_minutes} min` : "No feed posts";
  return row.takes_reader_requests ? `${feed}, and reader requests` : feed;
}

function LastCall({ row }: { row: NotewriterRow }) {
  const [loadedAt] = useState(Date.now);
  const silent = !row.outside && (!row.last_seen_at || loadedAt - new Date(row.last_seen_at).getTime() > SILENCE_MS);
  return (
    <>
      <span className={cn(silent && "text-negative")}>{row.last_seen_at ? timeAgo(row.last_seen_at) : "Never"}</span>
      {row.last_failure && row.last_failure_at && (
        <p className={cn(SUBLINE, "line-clamp-2")} title={row.last_failure}>
          Last failure {timeAgo(row.last_failure_at)}: {row.last_failure}
        </p>
      )}
    </>
  );
}

/** Every notewriter (GOO-791): what it takes, when it last called, and how
 *  its last week went. */
export function Notewriters() {
  const query = useQuery({ queryKey: queryKeys.dashboardNotewriters, queryFn: fetchNotewriters });
  if (!query.data) return <LoadState error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <DashboardTable columns={COLUMNS}>
      {query.data.map((row) => (
        <tr key={row.id} className={cn(row.disabled_at && "opacity-60")}>
          <td className={CELL}>
            {row.name}
            <p className={SUBLINE}>
              {row.id} · {row.owner}
              {row.outside && " · outside"}
              {row.disabled_at && ` · switched off ${timeAgo(row.disabled_at)}`}
            </p>
          </td>
          <td className={CELL}>
            {takes(row)}
            <p className={SUBLINE}>Holds a post at most {row.lease_minutes} min</p>
          </td>
          <td className={CELL}>
            <LastCall row={row} />
          </td>
          <td className={NUMBER_CELL}>{row.open_reservations}</td>
          <td className={NUMBER_CELL}>
            {postCount(row.done_7d)}
            <p className={SUBLINE}>{row.skipped_7d} skipped</p>
          </td>
          <td className={cn(NUMBER_CELL, row.failed_7d + row.expired_7d > 0 && "text-negative")}>
            {row.failed_7d}
            <p className={SUBLINE}>{row.expired_7d} expired</p>
          </td>
          <td className={NUMBER_CELL}>
            {row.notes_7d}
            <p className={SUBLINE}>{row.notes_total} in all</p>
          </td>
        </tr>
      ))}
    </DashboardTable>
  );
}
