import type { ChartGranularity, ChartMode } from "../lib/types";

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex bg-gray-100 rounded p-0.5 text-sm">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded transition-colors ${
            value === opt.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ChartControls({
  granularity,
  mode,
  onGranularityChange,
  onModeChange,
}: {
  granularity: ChartGranularity;
  mode: ChartMode;
  onGranularityChange: (g: ChartGranularity) => void;
  onModeChange: (m: ChartMode) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <ToggleGroup
        value={granularity}
        onChange={onGranularityChange}
        options={[
          { value: "weekly", label: "Weekly" },
          { value: "daily", label: "Daily" },
        ]}
      />
      <ToggleGroup
        value={mode}
        onChange={onModeChange}
        options={[
          { value: "absolute", label: "Helpful / unhelpful" },
          { value: "ratio", label: "Ratio" },
        ]}
      />
    </div>
  );
}

export function ChartLegend({ mode }: { mode: ChartMode }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-gray-600">
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500" /> Helpful</span>
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500" /> Not helpful</span>
      {mode === "ratio" && (
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-gray-400" /> Needs more ratings / pending</span>
      )}
    </div>
  );
}
