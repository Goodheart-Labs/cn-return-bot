import type { DailyRow } from "../lib/queries";

const SERIES: { key: string; label: string; color: string }[] = [
  { key: "pageview", label: "Website pageviews", color: "#2563eb" },
  { key: "notes_shown", label: "Extension notes shown", color: "#7c3aed" },
];

const CHART_HEIGHT = 160;
const BAR_GAP = 2;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Grouped daily bars for pageviews and notes-shown. Days with no data render
 *  as empty slots so gaps are visible instead of being compressed away. */
export function DailyChart({ rows, days }: { rows: DailyRow[]; days: number }) {
  const today = new Date();
  const allDays: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    allDays.push(isoDay(new Date(today.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  const total = (day: string, event: string) =>
    rows.filter((r) => r.day === day && r.event === event).reduce((sum, r) => sum + r.events, 0);
  const max = Math.max(...allDays.flatMap((d) => SERIES.map((s) => total(d, s.key))), 1);

  const groupWidth = Math.max(6, Math.min(28, Math.floor(900 / allDays.length)));
  const barWidth = (groupWidth - BAR_GAP) / SERIES.length;
  const width = allDays.length * (groupWidth + BAR_GAP);

  return (
    <div>
      <div style={{ display: "flex", gap: 16, fontSize: 13, marginBottom: 8 }}>
        {SERIES.map((s) => (
          <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, background: s.color, borderRadius: 2, display: "inline-block" }} />
            {s.label}
          </span>
        ))}
        <span style={{ color: "#6b7280", marginLeft: "auto" }}>max {max.toLocaleString()}/day</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg width={width} height={CHART_HEIGHT + 20} style={{ display: "block" }}>
          {allDays.map((day, i) => (
            <g key={day} transform={`translate(${i * (groupWidth + BAR_GAP)}, 0)`}>
              {SERIES.map((s, j) => {
                const n = total(day, s.key);
                const h = Math.round((n / max) * CHART_HEIGHT);
                return (
                  <rect
                    key={s.key}
                    x={j * barWidth}
                    y={CHART_HEIGHT - h}
                    width={Math.max(barWidth - 1, 1)}
                    height={h}
                    fill={s.color}
                  >
                    <title>{`${day}: ${n.toLocaleString()} ${s.label}`}</title>
                  </rect>
                );
              })}
              {(allDays.length <= 14 || i % 7 === 0) && (
                <text x={groupWidth / 2} y={CHART_HEIGHT + 14} textAnchor="middle" fontSize={9} fill="#6b7280">
                  {day.slice(5)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
