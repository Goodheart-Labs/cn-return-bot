import { type FailureType, FAILURE_TYPE_CONFIG, type FilterState } from "../lib/types";

interface FilterBarProps {
  source: "production" | "dataset_run";
  filters: FilterState;
  counts: Record<FailureType, number>;
  onFiltersChange: (filters: FilterState) => void;
}

export function FilterBar({ source, filters, counts, onFiltersChange }: FilterBarProps) {
  const toggleFailureType = (ft: FailureType) => {
    const next = new Set(filters.failureTypes);
    if (next.has(ft)) next.delete(ft);
    else next.add(ft);
    onFiltersChange({ ...filters, failureTypes: next });
  };

  const cycleSeen = () => {
    const order: FilterState["seen"][] = ["all", "unseen", "seen"];
    const idx = order.indexOf(filters.seen);
    onFiltersChange({ ...filters, seen: order[(idx + 1) % order.length]! });
  };

  const visibleTypes = (Object.entries(FAILURE_TYPE_CONFIG) as [FailureType, typeof FAILURE_TYPE_CONFIG[FailureType]][])
    .filter(([, cfg]) => source === "production" ? cfg.production : cfg.datasetRun);

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {/* Seen filter */}
      <button
        onClick={cycleSeen}
        className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
          filters.seen === "all"
            ? "bg-white text-gray-600 border-gray-300"
            : filters.seen === "unseen"
              ? "bg-blue-100 text-blue-800 border-blue-300"
              : "bg-gray-200 text-gray-700 border-gray-400"
        }`}
      >
        {filters.seen === "all" ? "All" : filters.seen === "unseen" ? "Unseen" : "Seen"}
      </button>

      <div className="w-px h-6 bg-gray-300" />

      {/* Failure type filters */}
      {visibleTypes.map(([ft, cfg]) => {
        const active = filters.failureTypes.has(ft);
        const count = counts[ft] ?? 0;
        return (
          <button
            key={ft}
            onClick={() => toggleFailureType(ft)}
            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
              active ? cfg.color + " border-current" : "bg-white text-gray-400 border-gray-200"
            }`}
          >
            {cfg.label}
            {count > 0 && (
              <span className="ml-1.5 text-xs opacity-70">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
