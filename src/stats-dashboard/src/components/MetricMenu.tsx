import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BASE_STAT_OPTIONS,
  statLabel,
  type AbComparisonStat,
  type RatingReasonCatalog,
  type ReasonUsage,
} from "../lib/abComparison";
import { humanizeTagName } from "../../../dashboard-shared/ratingReasons";

type SubKey = "failure_mode" | "rating_type";

// The metric picker. The base metrics are plain rows. Below them sit two rows
// that open a submenu when the pointer rests on them. Failure Mode lists the
// review tags, and Rating Type lists the rating reasons. The menu is written by
// hand because this repo has no menu library. It opens and closes the same way
// the review dashboard's FailureModeSelector does.
export function MetricMenu({
  stat,
  onStatChange,
  failureModeCatalog,
  ratingReasonCatalog,
}: {
  stat: AbComparisonStat;
  onStatChange: (stat: AbComparisonStat) => void;
  failureModeCatalog: ReasonUsage[];
  ratingReasonCatalog: RatingReasonCatalog;
}) {
  const [open, setOpen] = useState(false);
  const [openSub, setOpenSub] = useState<SubKey | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!open) setOpenSub(null);
  }, [open]);

  const select = (next: AbComparisonStat) => {
    onStatChange(next);
    setOpen(false);
  };

  const hasRatingReasons =
    ratingReasonCatalog.positive.length > 0 || ratingReasonCatalog.negative.length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="border border-gray-300 rounded px-2 py-1 bg-white text-sm min-w-[13rem] text-left flex items-center justify-between gap-2 hover:bg-gray-50"
      >
        <span className="truncate">{statLabel(stat)}</span>
        <span className="text-gray-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
          {BASE_STAT_OPTIONS.map((kind) => (
            <MenuRow
              key={kind}
              label={statLabel({ kind })}
              active={stat.kind === kind}
              onClick={() => select({ kind })}
            />
          ))}

          <div className="my-1 border-t border-gray-100" />

          <ParentRow
            label="Failure Mode"
            active={stat.kind === "failure_mode"}
            open={openSub === "failure_mode"}
            disabled={failureModeCatalog.length === 0}
            onOpen={() => setOpenSub("failure_mode")}
            onClose={() => setOpenSub(null)}
          >
            <SubMenu>
              {failureModeCatalog.map((m) => (
                <LeafRow
                  key={m.name}
                  label={m.name}
                  count={m.count}
                  active={stat.kind === "failure_mode" && stat.tag === m.name}
                  onClick={() => select({ kind: "failure_mode", tag: m.name })}
                />
              ))}
            </SubMenu>
          </ParentRow>

          <ParentRow
            label="Rating Type"
            active={stat.kind === "rating_type"}
            open={openSub === "rating_type"}
            disabled={!hasRatingReasons}
            onOpen={() => setOpenSub("rating_type")}
            onClose={() => setOpenSub(null)}
          >
            <SubMenu>
              <GroupHeader label="Not helpful" />
              {ratingReasonCatalog.negative.map((r) => (
                <LeafRow
                  key={r.name}
                  label={humanizeTagName(r.name)}
                  count={r.count}
                  active={stat.kind === "rating_type" && stat.reason === r.name}
                  onClick={() => select({ kind: "rating_type", reason: r.name })}
                />
              ))}
              <GroupHeader label="Helpful" />
              {ratingReasonCatalog.positive.map((r) => (
                <LeafRow
                  key={r.name}
                  label={humanizeTagName(r.name)}
                  count={r.count}
                  active={stat.kind === "rating_type" && stat.reason === r.name}
                  onClick={() => select({ kind: "rating_type", reason: r.name })}
                />
              ))}
            </SubMenu>
          </ParentRow>
        </div>
      )}
    </div>
  );
}

function MenuRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${active ? "bg-blue-50 text-blue-700" : "text-gray-700"}`}
    >
      {label}
    </button>
  );
}

// The parent row and its submenu sit in one container. The submenu starts flush
// against the row's right edge, with no gap in between. The pointer can
// therefore travel from the row into the submenu without leaving the container
// and closing it. Clicking the row toggles the submenu as well, which is what
// people who cannot hover need.
function ParentRow({
  label,
  active,
  open,
  disabled,
  onOpen,
  onClose,
  children,
}: {
  label: string;
  active: boolean;
  open: boolean;
  disabled: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="relative"
      onMouseEnter={disabled ? undefined : onOpen}
      onMouseLeave={disabled ? undefined : onClose}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? onClose() : onOpen())}
        className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 ${
          disabled ? "text-gray-300 cursor-default" : "hover:bg-gray-50"
        } ${active && !disabled ? "bg-blue-50 text-blue-700" : disabled ? "" : "text-gray-700"}`}
      >
        <span>{label}</span>
        <span className={disabled ? "text-gray-200" : "text-gray-400"}>▸</span>
      </button>
      {open && !disabled && children}
    </div>
  );
}

function SubMenu({ children }: { children: ReactNode }) {
  return (
    <div className="absolute left-full top-0 -mt-1 w-64 max-h-80 overflow-y-auto bg-white rounded-lg shadow-lg border border-gray-200 py-1">
      {children}
    </div>
  );
}

function GroupHeader({ label }: { label: string }) {
  return (
    <div className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
  );
}

function LeafRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 hover:bg-gray-50 ${
        active ? "bg-blue-50 text-blue-700" : "text-gray-700"
      }`}
    >
      <span className="truncate">{label}</span>
      {count > 0 && <span className="text-[10px] text-gray-400 shrink-0">{count.toLocaleString("en-US")}</span>}
    </button>
  );
}
