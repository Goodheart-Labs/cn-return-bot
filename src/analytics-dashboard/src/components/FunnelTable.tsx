import type { FunnelRow, FunnelStage } from "../lib/queries";

const STAGES: { stage: FunnelStage; label: string }[] = [
  { stage: "visitors", label: "Visitors" },
  { stage: "signed_in", label: "Signed in" },
  { stage: "voted_1", label: "Voted ≥1 note" },
  { stage: "voted_5", label: "Voted ≥5 notes" },
  { stage: "voted_10", label: "Voted ≥10 notes" },
];

const PLATFORM_LABELS: Record<string, string> = {
  web: "Website",
  extension: "Extension",
  unknown: "Unknown platform",
};

const BAR_COLORS: Record<string, string> = {
  web: "#2563eb",
  extension: "#7c3aed",
  unknown: "#9ca3af",
};

/** One funnel column per platform: stage rows with counts and a bar scaled to
 *  the platform's largest stage, so each column reads top-down as a funnel. */
export function FunnelTable({ rows }: { rows: FunnelRow[] }) {
  const platforms = ["web", "extension", "unknown"].filter((p) => rows.some((r) => r.platform === p));
  const count = (platform: string, stage: FunnelStage) =>
    rows.find((r) => r.platform === platform && r.stage === stage)?.users ?? 0;

  return (
    <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
      {platforms.map((platform) => {
        const max = Math.max(...STAGES.map(({ stage }) => count(platform, stage)), 1);
        return (
          <div key={platform} style={{ flex: "1 1 280px", maxWidth: 420 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>{PLATFORM_LABELS[platform] ?? platform}</h3>
            {STAGES.map(({ stage, label }) => {
              const n = count(platform, stage);
              return (
                <div key={stage} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2 }}>
                    <span style={{ color: "#4b5563" }}>{label}</span>
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
      {platforms.length === 0 && <p style={{ color: "#6b7280" }}>No data in this window yet.</p>}
    </div>
  );
}
