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
  showNonCandidate,
  showNonCandidateAvailable,
  onGranularityChange,
  onModeChange,
  onShowNonCandidateChange,
}: {
  granularity: ChartGranularity;
  mode: ChartMode;
  showNonCandidate: boolean;
  showNonCandidateAvailable: boolean;
  onGranularityChange: (g: ChartGranularity) => void;
  onModeChange: (m: ChartMode) => void;
  onShowNonCandidateChange: (v: boolean) => void;
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
          { value: "share", label: "% of all" },
        ]}
      />
      {showNonCandidateAvailable && mode === "ratio" && (
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showNonCandidate}
            onChange={(e) => onShowNonCandidateChange(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Include non-candidate runs
        </label>
      )}
    </div>
  );
}

export function ChartLegend({ mode, showNonCandidate }: { mode: ChartMode; showNonCandidate: boolean }) {
  if (mode === "share") {
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-600" /> Our notes</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-400" /> Top other AI notewriters</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-200" /> Human-written</span>
        <span className="text-gray-400">— share of rated-helpful Community Notes</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-4 text-xs text-gray-600">
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500" /> Helpful</span>
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500" /> Not helpful</span>
      {mode === "ratio" && (
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-gray-400" /> Needs more ratings / pending</span>
      )}
      {mode === "ratio" && showNonCandidate && (
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-gray-900" /> Non-candidate pipeline runs</span>
      )}
    </div>
  );
}
