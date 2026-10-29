import type { ReactNode } from "react";

/** Names each series of a chart next to a square of its colour. `note` adds a
 *  line of explanation after the names. */
export function ChartLegend({ items, note }: { items: readonly { label: string; color: string }[]; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-secondary">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
      {note && <span className="text-fg-muted">{note}</span>}
    </div>
  );
}
