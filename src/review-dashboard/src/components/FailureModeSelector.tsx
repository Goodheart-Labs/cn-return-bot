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
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus the search box on open; clear the query on close.
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQuery("");
  }, [open]);

  const sortedCatalog = useMemo(() => {
    return [...catalog].sort((a, b) => {
      const ca = usage.get(a.name) ?? 0;
      const cb = usage.get(b.name) ?? 0;
      if (cb !== ca) return cb - ca;
      return a.name.localeCompare(b.name);
    });
  }, [catalog, usage]);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedCatalog;
    return sortedCatalog.filter((m) => m.name.toLowerCase().includes(q));
  }, [sortedCatalog, query]);

  const toggle = (mode: string) => {
    if (selected.includes(mode)) {
      onChange(selected.filter((m) => m !== mode));
    } else {
      onChange([...selected, mode]);
    }
  };

  const createMode = (name: string) => {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return;
    onCreateNew(normalized);
    if (!selected.includes(normalized)) {
      onChange([...selected, normalized]);
    }
    setQuery("");
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
          <div className="sticky top-0 bg-white px-2 pt-1 pb-2 border-b border-gray-100">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (filteredCatalog.length > 0) {
                    toggle(filteredCatalog[0].name);
                    setQuery("");
                  } else {
                    createMode(query);
                  }
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder="Search failure modes..."
              className="w-full text-sm border border-gray-200 rounded px-2 py-1"
            />
          </div>
          {filteredCatalog.length === 0 && query.trim() && (
            <button
              onClick={() => createMode(query)}
              className="w-full flex items-center gap-1 px-3 py-1.5 text-left text-sm text-purple-700 hover:bg-purple-50"
            >
              <span className="font-medium">+</span>
              <span>Add "{query.trim().toLowerCase()}"</span>
            </button>
          )}
          {filteredCatalog.length === 0 && !query.trim() && (
            <div className="px-3 py-2 text-xs text-gray-400">No failure modes</div>
          )}
          {filteredCatalog.map((mode) => {
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
        </div>
      )}
    </div>
  );
}
