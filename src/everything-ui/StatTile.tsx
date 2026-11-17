import type { ReactNode } from "react";
import { Card } from "./Card";

/** One headline number with its label above it. Tiles in a row share the
 *  width and wrap on a narrow screen. */
export function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="min-w-40 flex-1 px-4 py-3">
      <div className="text-sm text-fg-muted">{label}</div>
      <div className="font-title text-2xl font-bold tabular-nums text-fg">{value}</div>
    </Card>
  );
}
