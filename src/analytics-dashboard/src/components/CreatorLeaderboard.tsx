import type { CreatorRow } from "../lib/queries";

/** How many creators are listed before the rest fold into one summary line. */
const MAX_ROWS = 30;

const BAR_COLOR = "#0d9488";

/** Creators ranked by how many visits their posts got, one labeled bar per
 *  creator, scaled to the top creator. A row's name is the project name when
 *  we can attribute the visit, and the page's hostname when we cannot. */
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
        <div key={row.creator} style={{ marginBottom: 8 }}>
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
