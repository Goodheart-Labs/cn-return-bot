import { useEffect, useState } from "react";
import {
  fetchCreators,
  fetchDaily,
  fetchFunnel,
  WINDOWS,
  type CreatorRow,
  type DailyRow,
  type FunnelRow,
  type TimeWindow,
} from "./lib/queries";
import { FunnelTable } from "./components/FunnelTable";
import { DailyChart } from "./components/DailyChart";
import { CreatorLeaderboard } from "./components/CreatorLeaderboard";

export function App() {
  const [timeWindow, setWindow] = useState<TimeWindow>(WINDOWS[1]!);
  const [funnel, setFunnel] = useState<FunnelRow[] | null>(null);
  const [daily, setDaily] = useState<DailyRow[] | null>(null);
  const [creators, setCreators] = useState<CreatorRow[] | null>(null);
  const [creatorsError, setCreatorsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFunnel(null);
    setDaily(null);
    setCreators(null);
    setCreatorsError(null);
    setError(null);
    Promise.all([fetchFunnel(timeWindow.days), fetchDaily(timeWindow.days)])
      .then(([f, d]) => {
        setFunnel(f);
        setDaily(d);
      })
      .catch((e: Error) => setError(e.message));
    // The leaderboard loads on its own, so a backend missing its function
    // (migration 084 not applied yet) blanks only this section, not the page.
    fetchCreators(timeWindow.days)
      .then(setCreators)
      .catch((e: Error) => setCreatorsError(e.message));
  }, [timeWindow]);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Common Notes analytics</h1>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              onClick={() => setWindow(w)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                background: w.label === timeWindow.label ? "#111827" : "#fff",
                color: w.label === timeWindow.label ? "#fff" : "#111827",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p style={{ color: "#b91c1c" }}>Failed to load: {error}</p>}
      {!error && (!funnel || !daily) && <p style={{ color: "#6b7280" }}>Loading…</p>}

      {funnel && (
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 17, marginBottom: 16 }}>Funnel</h2>
          <FunnelTable rows={funnel} />
        </section>
      )}

      {daily && (
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 17, marginBottom: 16 }}>Daily activity</h2>
          <DailyChart rows={daily} days={timeWindow.days} />
        </section>
      )}

      {(creators || creatorsError) && (
        <section>
          <h2 style={{ fontSize: 17, marginBottom: 16 }}>Creators by visits</h2>
          {creatorsError && <p style={{ color: "#b91c1c" }}>Failed to load: {creatorsError}</p>}
          {creators && <CreatorLeaderboard rows={creators} />}
        </section>
      )}
    </div>
  );
}
