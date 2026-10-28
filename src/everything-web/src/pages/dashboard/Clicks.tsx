import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchClickCounts, type ClickCount } from "@cn/core/dashboard";
import { queryKeys } from "@cn/features/query/queryKeys";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import type { GetExtensionButton } from "../../lib/extensionStores";
import { noteUrl } from "../../lib/routing";
import { CELL, DashboardTable, LoadState, NUMBER_CELL, SUBLINE, type Column } from "./tableParts";

type RangeId = "7" | "30" | "90";
const RANGES: readonly { id: RangeId; label: string; days: number }[] = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
];
const DAY_MS = 24 * 3600 * 1000;

const BUTTON_NAMES: Record<GetExtensionButton, string> = {
  header: "Site header",
  nudge: "Pop-up nudge",
  write_note: "Write-a-note window",
  home: "Homepage main button",
};

const COUNT_COLUMNS: readonly Column[] = [
  { label: "Clicks", align: "right", explanation: "Every click, outside our own admin accounts." },
  { label: "Devices", align: "right", explanation: "How many different browsers clicked. One person on two computers counts twice." },
];

const NOTE_COLUMNS: readonly Column[] = [
  { label: "Note", align: "left", explanation: "A note whose own link was opened. The tweets we post link to single notes. The most opened note comes first." },
  { label: "Opens", align: "right", explanation: "How often the note's link was opened, outside our own admin accounts." },
  COUNT_COLUMNS[1]!,
];

function CountTable({ label, rows }: { label: Column; rows: (ClickCount & { name: string })[] }) {
  if (rows.length === 0) return <p className="text-sm text-fg-muted">No clicks in this time.</p>;
  return (
    <DashboardTable columns={[label, ...COUNT_COLUMNS]}>
      {rows.map((row) => (
        <tr key={row.name}>
          <td className={CELL}>{row.name}</td>
          <td className={NUMBER_CELL}>{row.clicks}</td>
          <td className={NUMBER_CELL}>{row.devices}</td>
        </tr>
      ))}
    </DashboardTable>
  );
}

/** How often people took a step towards the extension: opened a link to one
 *  note, which is where the tweets we post lead, clicked a "Get the
 *  extension" button, and clicked through to a store. Store clicks are counted
 *  only since 2026-10-28: before that the database refused them (migration
 *  154). */
export function Clicks() {
  const [rangeId, setRangeId] = useState<RangeId>("30");
  const days = RANGES.find((range) => range.id === rangeId)!.days;
  const query = useQuery({ queryKey: queryKeys.dashboardClicks(days), queryFn: () => fetchClickCounts(new Date(Date.now() - days * DAY_MS)) });
  const counts = query.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-secondary">
          {counts ? `${counts.noteOpens} opens of a link to one note.` : "Steps people took towards the extension."} Store clicks are counted from 2026-10-28 on.
        </p>
        <SegmentedControl label="Time range" options={RANGES} value={rangeId} onChange={setRangeId} />
      </div>
      {!counts ? (
        <LoadState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="font-medium text-fg">"Get the extension" buttons</h3>
            <CountTable
              label={{ label: "Button", align: "left", explanation: "Where on the website the button sits." }}
              rows={counts.getExtension.map((row) => ({ ...row, name: BUTTON_NAMES[row.button as GetExtensionButton] ?? row.button }))}
            />
          </section>
          <section className="space-y-2">
            <h3 className="font-medium text-fg">Store buttons</h3>
            <CountTable label={{ label: "Store", align: "left", explanation: "The browser whose extension store the button opens." }} rows={counts.stores.map((row) => ({ ...row, name: row.browser }))} />
          </section>
          <section className="space-y-2">
            <h3 className="font-medium text-fg">Links to one note</h3>
            {counts.notes.length === 0 ? (
              <p className="text-sm text-fg-muted">No note links were opened in this time.</p>
            ) : (
              <DashboardTable columns={NOTE_COLUMNS}>
                {counts.notes.map((row) => (
                  <tr key={row.note_id}>
                    <td className={CELL}>
                      {row.slug ? (
                        <a href={noteUrl(row.slug, row.note_id)} target="_blank" rel="noreferrer" className="line-clamp-2 text-link hover:underline">
                          {row.note ?? "A deleted note"}
                        </a>
                      ) : (
                        <span className="text-fg-muted">A deleted note</span>
                      )}
                      {row.creator && <p className={SUBLINE}>{row.creator}</p>}
                    </td>
                    <td className={NUMBER_CELL}>{row.opens}</td>
                    <td className={NUMBER_CELL}>{row.devices}</td>
                  </tr>
                ))}
              </DashboardTable>
            )}
          </section>
        </>
      )}
    </div>
  );
}
