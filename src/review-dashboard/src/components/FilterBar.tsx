import { type FailureType, FAILURE_TYPE_CONFIG, type FilterState, type FailureTypeConfig, defaultFilters } from "../lib/types";

interface FilterBarProps {
  source: "production" | "dataset_run";
  filters: FilterState;
  counts: Record<FailureType, number>;
  onFiltersChange: (filters: FilterState) => void;
}

function FilterChip({ ft, cfg, active, count, onClick }: {
  ft: FailureType;
  cfg: FailureTypeConfig;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      key={ft}
      onClick={onClick}
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

  const toggleHighValue = () => {
    if (!filters.highValueOnly) {
      // Entering the ★ lens: reset the other filters to non-restrictive so the
      // list starts as ALL starred notes; narrowing back is opt-in and visible.
      onFiltersChange({ seen: "all", failureTypes: new Set(), failureModes: new Set(), highValueOnly: true });
    } else {
      // Leaving: back to the standard default view rather than whatever
      // narrowing was applied inside the lens.
      onFiltersChange(defaultFilters(source));
    }
  };

  const visibleTypes = (Object.entries(FAILURE_TYPE_CONFIG) as [FailureType, FailureTypeConfig][])
    .filter(([, cfg]) => source === "production" ? cfg.production : cfg.datasetRun);

  const hasGroups = visibleTypes.some(([, cfg]) => cfg.group);

  const renderChip = ([ft, cfg]: [FailureType, FailureTypeConfig]) => (
    <FilterChip
      key={ft}
      ft={ft}
      cfg={cfg}
      active={filters.failureTypes.has(ft)}
      count={counts[ft] ?? 0}
      onClick={() => toggleFailureType(ft)}
    />
  );

  return (
    <div className="flex flex-wrap gap-2 items-center">
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

      {source === "production" && (
        <button
          onClick={toggleHighValue}
          title="Show only high-value (starred ★) notes, all-time"
          className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
            filters.highValueOnly
              ? "bg-amber-100 text-amber-800 border-amber-400"
              : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
          }`}
        >
          {filters.highValueOnly ? "★" : "☆"} High-value notes
        </button>
      )}

      <div className="w-px h-6 bg-gray-300" />

      {hasGroups ? (
        <>
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">NW</span>
          {visibleTypes.filter(([, cfg]) => cfg.group === "noteworthy").map(renderChip)}
          <div className="w-px h-6 bg-gray-300" />
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">NNW</span>
          {visibleTypes.filter(([, cfg]) => cfg.group === "non_noteworthy").map(renderChip)}
          {visibleTypes.filter(([, cfg]) => !cfg.group).length > 0 && (
            <>
              <div className="w-px h-6 bg-gray-300" />
              {visibleTypes.filter(([, cfg]) => !cfg.group).map(renderChip)}
            </>
          )}
        </>
      ) : (
        visibleTypes.map(renderChip)
      )}
    </div>
  );
}
