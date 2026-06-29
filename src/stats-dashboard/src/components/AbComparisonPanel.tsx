import { useState } from "react";
import type { ABTestSlotInfo } from "../../../dashboard-shared/abFilters";
import {
  forcesAllRuns,
  lowerIsBetter,
  statInterval,
  statKind,
  STAT_LABELS,
  type AbCombo,
  type AbComparisonStat,
  type AbStatKind,
} from "../lib/abComparison";
import { Z_BY_LEVEL, type ConfidenceLevel } from "../lib/confidenceIntervals";
import { CiAxis, CiBar, computeDomain } from "./CiBar";
import { useResizeWidth } from "../lib/useResizeWidth";

// Grid template shared by the axis row and every data row so the CI blocks line
// up under the axis: [label gutter] [chart column] [hide button].
const GRID_COLUMNS = "minmax(11rem, 18rem) 1fr 1.25rem";

const STAT_OPTIONS = Object.keys(STAT_LABELS) as AbComparisonStat[];
const LEVEL_OPTIONS: ConfidenceLevel[] = [90, 95, 99];

function formatValue(point: number, kind: AbStatKind): string {
  if (kind === "cost") return `$${point.toFixed(point < 1 ? 3 : 2)}`;
  const pct = (Math.abs(point) * 100).toFixed(1);
  if (kind === "diff") return `${point >= 0 ? "+" : "−"}${pct}%`;
  return `${pct}%`;
}

export function AbComparisonPanel({
  slots,
  combos,
  dims,
  onDimsChange,
  stat,
  onStatChange,
  includeNonCandidate,
  onIncludeNonCandidateChange,
  level,
  onLevelChange,
  hidden,
  onHiddenChange,
}: {
  slots: ABTestSlotInfo[];
  combos: AbCombo[];
  dims: string[];
  onDimsChange: (dims: string[]) => void;
  stat: AbComparisonStat;
  onStatChange: (stat: AbComparisonStat) => void;
  includeNonCandidate: boolean;
  onIncludeNonCandidateChange: (v: boolean) => void;
  level: ConfidenceLevel;
  onLevelChange: (level: ConfidenceLevel) => void;
  hidden: Set<string>;
  onHiddenChange: (hidden: Set<string>) => void;
}) {
  const [chartRef, chartWidth] = useResizeWidth<HTMLDivElement>();

  const kind = statKind(stat);
  const forceAll = forcesAllRuns(stat);
  const z = Z_BY_LEVEL[level];

  // Map each combo to its interval; null when the chosen stat has no sample.
  const rows = combos.map((combo) => ({
    combo,
    result: statInterval(combo.counts, stat, forceAll ? true : includeNonCandidate, z),
  }));
  const visible = rows.filter((r) => !hidden.has(r.combo.key));
  const hiddenRows = rows.filter((r) => hidden.has(r.combo.key));

  // Shared x-axis domain across visible rows that have data; rows are sorted so
  // the best is on top (highest %, or cheapest cost), no-data rows sink down.
  const domain = computeDomain(
    visible.flatMap((r) => (r.result ? [r.result.interval] : [])),
    kind,
  );
  const sortedVisible = [...visible].sort((a, b) => {
    if (a.result && b.result) {
      const cmp = a.result.interval.point - b.result.interval.point;
      return lowerIsBetter(stat) ? cmp : -cmp;
    }
    if (a.result) return -1;
    if (b.result) return 1;
    return a.combo.label.localeCompare(b.combo.label);
  });

  const hide = (key: string) => onHiddenChange(new Set(hidden).add(key));
  const restore = (key: string) => {
    const next = new Set(hidden);
    next.delete(key);
    onHiddenChange(next);
  };

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-3">
      <h2 className="text-lg font-semibold text-gray-800">A/B test comparison</h2>

      <DimensionPicker slots={slots} dims={dims} onDimsChange={onDimsChange} />

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <span className="text-xs uppercase tracking-wide text-gray-500">Metric</span>
          <select
            value={stat}
            onChange={(e) => onStatChange(e.target.value as AbComparisonStat)}
            className="border border-gray-300 rounded px-2 py-1 bg-white text-sm"
          >
            {STAT_OPTIONS.map((s) => (
              <option key={s} value={s}>{STAT_LABELS[s]}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <span className="text-xs uppercase tracking-wide text-gray-500">Confidence</span>
          <select
            value={level}
            onChange={(e) => onLevelChange(Number(e.target.value) as ConfidenceLevel)}
            className="border border-gray-300 rounded px-2 py-1 bg-white text-sm"
          >
            {LEVEL_OPTIONS.map((l) => (
              <option key={l} value={l}>{l}%</option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={forceAll ? true : includeNonCandidate}
            disabled={forceAll}
            onChange={(e) => onIncludeNonCandidateChange(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
          />
          Include non-candidate runs
        </label>
      </div>

      {dims.length === 0 ? (
        <p className="text-sm text-gray-500">Select one or more A/B tests to compare.</p>
      ) : combos.length === 0 ? (
        <p className="text-sm text-gray-500">No records match the current filters.</p>
      ) : (
        <div className="space-y-1">
          {/* shared x-axis (the metric) */}
          <div className="grid items-center gap-x-3" style={{ gridTemplateColumns: GRID_COLUMNS }}>
            <div className="text-xs uppercase tracking-wide text-gray-500 truncate">{STAT_LABELS[stat]}</div>
            <div ref={chartRef}>
              <CiAxis domain={domain} width={chartWidth} kind={kind} />
            </div>
            <div />
          </div>

          {sortedVisible.map(({ combo, result }) => (
            <div
              key={combo.key}
              className="grid items-center gap-x-3 group"
              style={{ gridTemplateColumns: GRID_COLUMNS }}
            >
              <div className="min-w-0">
                <div className="text-sm text-gray-800 break-words leading-tight" title={combo.label}>{combo.label}</div>
                <div className="text-xs text-gray-500">
                  {result ? (
                    <>n={result.n} · <span className="font-medium text-gray-700">{formatValue(result.interval.point, kind)}</span></>
                  ) : (
                    "no data"
                  )}
                </div>
              </div>
              <div>
                {result && <CiBar interval={result.interval} domain={domain} width={chartWidth} kind={kind} />}
              </div>
              <button
                onClick={() => hide(combo.key)}
                title="Hide this combination"
                className="text-gray-300 hover:text-gray-600 text-sm leading-none"
              >
                ✕
              </button>
            </div>
          ))}

          {hiddenRows.length > 0 && (
            <HiddenArea
              hiddenRows={hiddenRows.map((r) => r.combo)}
              onRestore={restore}
              onRestoreAll={() => onHiddenChange(new Set())}
            />
          )}
        </div>
      )}
    </section>
  );
}

function DimensionPicker({
  slots,
  dims,
  onDimsChange,
}: {
  slots: ABTestSlotInfo[];
  dims: string[];
  onDimsChange: (dims: string[]) => void;
}) {
  const [showOlder, setShowOlder] = useState(false);
  if (!slots.length) return null;

  const selected = new Set(dims);
  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    // Re-derive in slot order so combo labels stay stable regardless of click order.
    onDimsChange(slots.filter((s) => next.has(s.name)).map((s) => s.name));
  };

  const olderCount = slots.filter((s) => !s.recentlyVaried).length;
  const visibleSlots = slots.filter((s) => showOlder || s.recentlyVaried || selected.has(s.name));

  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Split by A/B test(s)</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {visibleSlots.map((slot) => (
          <label key={slot.name} className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selected.has(slot.name)}
              onChange={() => toggle(slot.name)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {slot.name}
          </label>
        ))}
      </div>
      {olderCount > 0 && (
        <button
          onClick={() => setShowOlder((o) => !o)}
          className="mt-2 text-xs text-blue-600 hover:text-blue-800"
        >
          {showOlder ? "Hide older tests" : `Show older tests (${olderCount})`}
        </button>
      )}
    </div>
  );
}

function HiddenArea({
  hiddenRows,
  onRestore,
  onRestoreAll,
}: {
  hiddenRows: AbCombo[];
  onRestore: (key: string) => void;
  onRestoreAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-2 mt-1 border-t border-gray-100">
      <div className="flex items-center gap-3 text-xs">
        <button onClick={() => setOpen((o) => !o)} className="text-blue-600 hover:text-blue-800">
          {open ? "Hide" : "Show"} hidden ({hiddenRows.length})
        </button>
        <button onClick={onRestoreAll} className="text-blue-600 hover:text-blue-800">Restore all</button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 mt-2">
          {hiddenRows.map((combo) => (
            <button
              key={combo.key}
              onClick={() => onRestore(combo.key)}
              title="Restore this combination"
              className="inline-flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded px-2 py-0.5"
            >
              {combo.label} <span className="text-gray-400">↩</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
