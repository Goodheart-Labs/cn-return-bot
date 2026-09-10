import { useEffect, useMemo, useState } from "react";
import { fetchPipelineDays, pipelineFunnelBars, type PipelineDayRow } from "../lib/queries";
import { TimeWindow, type DayWindow } from "./TimeWindow";
import { PipelineFunnel } from "./PipelineFunnel";

/** The window the section opens with: the most recent days. */
const DEFAULT_WINDOW_DAYS = 30;

const lastDays = (days: PipelineDayRow[]): DayWindow => ({ start: Math.max(0, days.length - DEFAULT_WINDOW_DAYS), end: days.length });

/** The pipeline funnel with its time window. The daily rows are fetched once;
 *  moving the window sums a different range of them, so the funnel follows
 *  the drag with no request. */
export function PipelineSection() {
  const [days, setDays] = useState<PipelineDayRow[] | null>(null);
  const [window, setWindow] = useState<DayWindow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPipelineDays()
      .then((rows) => {
        setDays(rows);
        setWindow(lastDays(rows));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const bars = useMemo(() => (days && window ? pipelineFunnelBars(days.slice(window.start, window.end)) : null), [days, window]);

  if (error) return <p style={{ color: "#b91c1c" }}>Failed to load: {error}</p>;
  if (!days || !window || !bars) return <p style={{ color: "#6b7280" }}>Loading…</p>;
  if (days.length === 0) return <p style={{ color: "#6b7280", fontSize: 13 }}>The pipeline has not finished a post yet.</p>;

  return (
    <div>
      <TimeWindow days={days} window={window} onChange={setWindow} />
      <PipelineFunnel bars={bars} />
      <p style={{ color: "#6b7280", fontSize: 12, margin: "8px 0 0" }}>
        The window picks posts by the day the pipeline finished them. The other bars count what those posts yielded, so each bar is a subset of the one before it. Whether a note is rated helpful uses today's votes.
      </p>
    </div>
  );
}
