import type { CreatorRow } from "../lib/queries";

/** How many creators are listed before the rest fold into one summary line. */
const MAX_ROWS = 30;

const BAR_COLOR = "#0d9488";

/** The reader line under a row's bar, e.g. "3 readers, 1 of them regular". A
 *  reader is one browser that opened anything of this creator's in the window,
 *  and a regular reader opened at least two different pages, which is what the
 *  pipeline walks creators on. Rows written before we recorded readers count
 *  towards visits and nothing else, so a creator can show visits and no
 *  readers. */
function readerTotals(row: CreatorRow): string | null {
  if (row.readers === 0) return null;
  const readers = row.readers === 1 ? "1 reader" : `${row.readers} readers`;
  return `${readers}, ${row.regular_readers} of them regular`;
}

/** The pipeline totals under a row's bar, e.g. "12 posts checked · 47 notes ·
 *  1 in error". Totals are unwindowed and zero when the creator's visits could
 *  not be attributed to a project, in which case the line is left out. */
function pipelineTotals(row: CreatorRow): string | null {
  if (row.processed === 0 && row.notes === 0 && row.errored === 0) return null;
  const parts = [`${row.processed} posts checked`, `${row.notes} notes`];
  if (row.errored > 0) parts.push(`${row.errored} in error`);
  return parts.join(" · ");
}

/** Creators ranked by how many visits their posts got, one labeled bar per
 *  creator, scaled to the top creator. A row's name is the project name when
 *  we can attribute the visit, and the page's hostname when we cannot.
 *
 *  Reader counts are shown per creator and are deliberately never added up
 *  across creators. A reader is recognised by a value that is different for
 *  every creator, so one person reading five creators appears as five
 *  unrelated readers, and a total would count reader-and-creator pairs rather
 *  than people. */
export function CreatorLeaderboard({ rows }: { rows: CreatorRow[] }) {
  if (rows.length === 0) {
    return <p style={{ color: "#6b7280", fontSize: 13 }}>No visits recorded in this window.</p>;
  }
  const max = Math.max(rows[0]!.visits, 1);
  const shown = rows.slice(0, MAX_ROWS);
  const foldedVisits = rows.slice(MAX_ROWS).reduce((sum, r) => sum + r.visits, 0);

  return (
    <div style={{ maxWidth: 560 }}>
      {shown.map((row) => (
        <div key={row.creator} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2 }}>
            <span style={{ color: "#4b5563", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.creator}
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", marginLeft: 12 }}>{row.visits.toLocaleString()}</span>
          </div>
          <div style={{ background: "#e5e7eb", borderRadius: 4, height: 12 }}>
            <div
              style={{
                width: `${Math.min((row.visits / max) * 100, 100)}%`,
                minWidth: 3,
                height: "100%",
                borderRadius: 4,
                background: BAR_COLOR,
              }}
            />
          </div>
          {[readerTotals(row), pipelineTotals(row)].filter(Boolean).map((line) => (
            <div key={line} style={{ color: "#9ca3af", fontSize: 12, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
              {line}
            </div>
          ))}
        </div>
      ))}
      {foldedVisits > 0 && (
        <p style={{ color: "#6b7280", fontSize: 13, marginTop: 12 }}>
          …and {rows.length - MAX_ROWS} more creators with {foldedVisits.toLocaleString()} visits.
        </p>
      )}
    </div>
  );
}
