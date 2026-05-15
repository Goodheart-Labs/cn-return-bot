import { useState, useRef, useEffect, useMemo } from "react";
import type { FailureModeInfo } from "../lib/types";

interface FailureModeSelectorProps {
  selected: string[];
  catalog: FailureModeInfo[];
  usage: Map<string, number>;
  onChange: (modes: string[]) => void;
  onCreateNew: (name: string) => void;
}

export function FailureModeSelector({
  selected,
  catalog,
  usage,
  onChange,
  onCreateNew,
}: FailureModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [newMode, setNewMode] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const sortedCatalog = useMemo(() => {
    return [...catalog].sort((a, b) => {
      const ca = usage.get(a.name) ?? 0;
      const cb = usage.get(b.name) ?? 0;
      if (cb !== ca) return cb - ca;
      return a.name.localeCompare(b.name);
    });
  }, [catalog, usage]);

  const toggle = (mode: string) => {
    if (selected.includes(mode)) {
      onChange(selected.filter((m) => m !== mode));
    } else {
      onChange([...selected, mode]);
    }
  };

  const handleCreate = () => {
    const normalized = newMode.trim().toLowerCase();
    if (!normalized) return;
    onCreateNew(normalized);
    if (!selected.includes(normalized)) {
      onChange([...selected, normalized]);
    }
    setNewMode("");
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-sm px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 flex items-center gap-1"
      >
        <span className="text-gray-500">Failure modes</span>
        {selected.length > 0 && (
          <span className="bg-purple-100 text-purple-700 text-xs px-1.5 rounded-full">
            {selected.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-20 mt-1 right-0 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-1 max-h-80 overflow-y-auto">
          {sortedCatalog.map((mode) => {
            const count = usage.get(mode.name) ?? 0;
            return (
              <label
                key={mode.name}
                className="flex items-center px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(mode.name)}
                  onChange={() => toggle(mode.name)}
                  className="mr-2"
                />
                <span className="flex-1">{mode.name}</span>
                {count > 0 && (
                  <span className="ml-2 text-[10px] text-gray-400">{count}</span>
                )}
              </label>
            );
          })}

          <div className="border-t border-gray-100 px-3 py-2 flex gap-1">
            <input
              type="text"
              value={newMode}
              onChange={(e) => setNewMode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Add new..."
              className="flex-1 text-sm border border-gray-200 rounded px-2 py-1"
            />
            <button
              onClick={handleCreate}
              className="text-sm px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
