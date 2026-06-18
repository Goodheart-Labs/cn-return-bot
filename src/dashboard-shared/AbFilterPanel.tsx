import type { ABFilters, ABTestSlotInfo } from "./abFilters";

export function AbFilterPanel({
  slots,
  filters,
  onChange,
  hideHeader = false,
}: {
  slots: ABTestSlotInfo[];
  filters: ABFilters;
  onChange: (filters: ABFilters) => void;
  // Omit the title + "Clear all" row — for callers that supply their own header
  // (e.g. a collapsible <summary>). Defaults to showing it.
  hideHeader?: boolean;
}) {
  if (!slots.length) return null;
  const handleSet = (slot: string, variant: string) => {
    const next = { ...filters };
    if (variant === "") delete next[slot];
    else next[slot] = variant;
    onChange(next);
  };
  const hasAny = Object.values(filters).some(Boolean);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      {!hideHeader && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-800">A/B test filters</h3>
          {hasAny && (
            <button
              onClick={() => onChange({})}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Clear all
            </button>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {slots.map((slot) => (
          <label key={slot.name} className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-gray-500">{slot.name}</span>
            <select
              value={filters[slot.name] ?? ""}
              onChange={(e) => handleSet(slot.name, e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 bg-white"
            >
              <option value="">all</option>
              {slot.variants.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
