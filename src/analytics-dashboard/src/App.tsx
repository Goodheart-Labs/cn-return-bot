import { useEffect, useState } from "react";
import { fetchCreators, fetchFunnel, WINDOWS, type CreatorRow, type FunnelRow, type TimeWindow } from "./lib/queries";
import { FunnelTable } from "./components/FunnelTable";
import { CreatorLeaderboard } from "./components/CreatorLeaderboard";
import { MetricsGraph } from "./components/MetricsGraph";
import { PipelineSection } from "./components/PipelineSection";
import { RecentPosts } from "./components/RecentPosts";
import { ToggleGroup } from "./components/ToggleGroup";

const WINDOW_OPTIONS = WINDOWS.map((w) => ({ value: w.label, label: w.label }));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 17, marginBottom: 16 }}>{title}</h2>
      {children}
    </section>
  );
}

export function App() {
  const [timeWindow, setWindow] = useState<TimeWindow>(WINDOWS[1]!);
  const [funnel, setFunnel] = useState<FunnelRow[] | null>(null);
  const [funnelError, setFunnelError] = useState<string | null>(null);
  const [creators, setCreators] = useState<CreatorRow[] | null>(null);
  const [creatorsError, setCreatorsError] = useState<string | null>(null);

  // Each section loads on its own, so a backend missing one function blanks
  // only that section, not the page.
  useEffect(() => {
    setFunnel(null);
    setFunnelError(null);
    setCreators(null);
    setCreatorsError(null);
    fetchFunnel(timeWindow.days)
      .then(setFunnel)
      .catch((e: Error) => setFunnelError(e.message));
    fetchCreators(timeWindow.days)
      .then(setCreators)
      .catch((e: Error) => setCreatorsError(e.message));
  }, [timeWindow]);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Common Notes analytics</h1>
      </header>

      <Section title="Common Notes metrics">
        <MetricsGraph />
      </Section>

      <Section title="Pipeline funnel">
        <PipelineSection />
      </Section>

      <Section title="Recently checked posts">
        <RecentPosts />
      </Section>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, fontSize: 13, color: "#6b7280" }}>
        The two sections below cover the last
        <ToggleGroup options={WINDOW_OPTIONS} value={timeWindow.label} onChange={(label) => setWindow(WINDOWS.find((w) => w.label === label)!)} />
      </div>

      <Section title="Creators by visits">
        {creatorsError && <p style={{ color: "#b91c1c" }}>Failed to load: {creatorsError}</p>}
        {!creatorsError && !creators && <p style={{ color: "#6b7280" }}>Loading…</p>}
        {creators && <CreatorLeaderboard rows={creators} />}
      </Section>

      <Section title="Reader funnel by platform">
        {funnelError && <p style={{ color: "#b91c1c" }}>Failed to load: {funnelError}</p>}
        {!funnelError && !funnel && <p style={{ color: "#6b7280" }}>Loading…</p>}
        {funnel && <FunnelTable rows={funnel} />}
      </Section>
    </div>
  );
}
