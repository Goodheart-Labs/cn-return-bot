import type { FunnelRow, FunnelStage } from "../lib/queries";

const STAGE_LABELS: Record<FunnelStage, string> = {
  visitors: "Visitors",
  installs: "Installs",
  shown_notes: "Shown notes",
  signed_in: "Signed in",
  voted_1: "Voted ≥1 note",
  voted_5: "Voted ≥5 notes",
  voted_10: "Voted ≥10 notes",
};

// Each platform funnels differently: the extension starts at installs, and
// "shown notes" counts only devices that installed in the window.
const PLATFORM_STAGES: Record<string, FunnelStage[]> = {
  web: ["visitors", "signed_in", "voted_1", "voted_5", "voted_10"],
  extension: ["installs", "shown_notes", "signed_in", "voted_1", "voted_5", "voted_10"],
};

const PLATFORM_LABELS: Record<string, string> = {
  web: "Website",
  extension: "Extension",
};

const BAR_COLORS: Record<string, string> = {
  web: "#2563eb",
  extension: "#7c3aed",
};

/** One funnel column per platform: stage rows with counts and a bar scaled to
 *  the platform's largest stage, so each column reads top-down as a funnel. */
export function FunnelTable({ rows }: { rows: FunnelRow[] }) {
  const count = (platform: string, stage: FunnelStage) =>
    rows.find((r) => r.platform === platform && r.stage === stage)?.users ?? 0;

  return (
    <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
      {Object.entries(PLATFORM_STAGES).map(([platform, stages]) => {
        const max = Math.max(...stages.map((stage) => count(platform, stage)), 1);
        return (
          <div key={platform} style={{ flex: "1 1 280px", maxWidth: 420 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>{PLATFORM_LABELS[platform] ?? platform}</h3>
            {stages.map((stage) => {
              const n = count(platform, stage);
              return (
                <div key={stage} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2 }}>
                    <span style={{ color: "#4b5563" }}>{STAGE_LABELS[stage]}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString()}</span>
                  </div>
                  <div style={{ background: "#e5e7eb", borderRadius: 4, height: 18 }}>
                    <div
                      style={{
                        width: `${(n / max) * 100}%`,
                        minWidth: n > 0 ? 3 : 0,
                        height: "100%",
                        borderRadius: 4,
                        background: BAR_COLORS[platform] ?? "#6b7280",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
