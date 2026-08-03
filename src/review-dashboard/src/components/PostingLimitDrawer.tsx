import { useState, useEffect, type ReactNode } from "react";
import { fetchPostingLimitData, type PostingLimitData, type CapWindow } from "../lib/data";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * Collapsed-by-default "Posting limit" drawer. Explains the current daily
 * writing cap: the observed number, X's formula, the live inputs, the tier
 * ladder, and which window the cap is currently resting on. Lazy-loads on first
 * open (a full-notes scan) so it costs nothing until opened.
 */
export function PostingLimitDrawer() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PostingLimitData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && !data && !loading) {
      setLoading(true);
      fetchPostingLimitData()
        .then(setData)
        .catch((e) => console.warn("Failed to load posting limit:", e))
        .finally(() => setLoading(false));
    }
  }, [open, data, loading]);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-gray-700 px-3 py-2 rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100"
      >
        <span className={`text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span>Posting limit</span>
        {data?.cap != null && <span className="text-xs text-blue-600">· {data.cap} notes / 24h</span>}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-gray-200 bg-white p-4">
          {loading && !data && <div className="text-sm text-gray-400">Loading live cap data…</div>}
          {data && <Body d={data} />}
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{children}</div>;
}

function WindowRow({ w }: { w: CapWindow }) {
  return (
    <div className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${w.binding ? "bg-blue-50 border border-blue-200" : "border border-transparent"}`}>
      <span className="w-36 text-gray-700">{w.label}</span>
      <span className={`w-14 tabular-nums font-semibold text-right ${w.rate < 0 ? "text-red-600" : "text-gray-900"}`}>{pct(w.rate)}</span>
      <span className="text-gray-400">
        {w.h}H · {w.nh}NH{w.nmr ? ` · ${w.nmr} NMR` : ""} / {w.denom}
      </span>
      {w.binding && <span className="ml-auto text-blue-600 font-medium whitespace-nowrap">◄ binding</span>}
    </div>
  );
}

function Body({ d }: { d: PostingLimitData }) {
  const boundLabel =
    d.bindingTerm === "quality" ? "quality-bound" : d.bindingTerm === "volume" ? "volume-bound" : "on a cliff";
  return (
    <div className="space-y-5 text-sm text-gray-700">
      {/* Accuracy caveat — the formula runs on our Supabase mirror, which can't
          reproduce X's real per-note statuses (7 statuses collapsed into 3; the
          HR_14d denominator here is rated-only). It has been off in both
          directions vs X's observed cap. */}
      <div className="rounded-md border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-gray-700">
        <b>Caveat:</b> the formula below is our reconstruction from mirror data and is <b>often wrong</b> —
        our DB can't see X's real per-note statuses. The big number (X's observed cap, learned from actual
        rejections) is the truth; treat the formula as directional only.
      </div>

      {/* Current daily limit */}
      <div className="flex items-baseline gap-3">
        <div className="text-4xl font-bold text-gray-900 tabular-nums leading-none">{d.cap ?? "—"}</div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Current daily limit</div>
          <div className="text-xs text-gray-500">
            notes / 24h · {boundLabel}
            {d.cap != null && d.modeledCap !== d.cap ? ` · formula says ${d.modeledCap}` : ""}
          </div>
        </div>
      </div>

      {/* The formula */}
      <div>
        <Label>The formula (X AI-writer rule)</Label>
        <pre className="bg-gray-50 border border-gray-200 rounded p-2 text-[11px] leading-relaxed text-gray-800 overflow-x-auto whitespace-pre-wrap font-mono">{`WL   = max(5, ⌊ min( DN_30 × 5 ,  WL_L ) ⌋)
WL_L = tiered on  HR_L = max(HR_100, HR_14d)
cliffs:  NH_5 ≥ 3 → 5    NH_10 ≥ 8 → 2`}</pre>
      </div>

      {/* The inputs — the bits lifted out */}
      <div>
        <Label>The inputs (live)</Label>
        <div className="text-[11px] text-gray-500 mb-1.5 px-2">
          % is <b>net</b> = (helpful − not-helpful) ÷ window — so it goes negative when a window has more
          not-helpful than helpful.
        </div>
        <div className="space-y-0.5">
          {d.windows.map((w) => (
            <WindowRow key={w.key} w={w} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 px-2">
          <span>
            DN_30 × 5 = <b className="tabular-nums">{d.volTerm.toFixed(0)}</b> ({d.dn30.toFixed(1)}/day)
          </span>
          <span>
            NH_5 = <b className={d.nh5 >= 3 ? "text-red-600" : ""}>{d.nh5}/5</b>
          </span>
          <span>
            NH_10 = <b className={d.nh10 >= 8 ? "text-red-600" : ""}>{d.nh10}/10</b>
          </span>
          <span>
            rated-at-all = <b>{pct(d.ratedAtAll)}</b> of {d.totalNotes.toLocaleString()}
          </span>
        </div>
      </div>

      {/* The tiers — the parts of the formula */}
      <div>
        <Label>WL_L tiers · HR_L = {pct(d.hrL)}</Label>
        <div className="space-y-0.5">
          {d.tiers.map((t) => (
            <div
              key={t.label}
              className={`flex items-center gap-3 text-[11px] px-2 py-1 rounded ${
                t.active ? "bg-blue-50 border border-blue-200 text-gray-900" : "text-gray-500 border border-transparent"
              }`}
            >
              <span className="w-14 font-medium tabular-nums">{t.label}</span>
              <span className="font-mono">{t.formula}</span>
              {t.active && (
                <span className="ml-auto text-blue-600 font-medium whitespace-nowrap">◄ WL_L {d.wlL.toFixed(0)}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* What's bottlenecking us */}
      <div className="rounded-md border-l-4 border-blue-400 bg-blue-50 px-3 py-2 text-xs text-gray-700">
        <div className="font-semibold text-gray-900 mb-0.5">What's bottlenecking us</div>
        {d.bindingTerm === "quality" && d.bindingWindow ? (
          <>
            Resting on <b>{d.bindingWindow.label}</b> ({d.bindingWindow.key}) at <b>{pct(d.bindingWindow.rate)}</b> — the
            best of the recent windows, so it's the one carrying us. Raise it ~1pp → cap{" "}
            <b>
              {d.slopePerPoint >= 0 ? "+" : ""}
              {d.slopePerPoint}
            </b>
            . Volume is slack (DN_30×5 = {d.volTerm.toFixed(0)} ≫ ceiling {d.wlL.toFixed(0)}); cliffs clear.
          </>
        ) : d.bindingTerm === "volume" ? (
          <>
            Volume-bound: DN_30×5 = <b>{d.volTerm.toFixed(0)}</b> is below the quality ceiling (WL_L {d.wlL.toFixed(0)}).
            Writing more raises next period's cap.
          </>
        ) : (
          <>
            On a collapse cliff (NH_5 {d.nh5}/5, NH_10 {d.nh10}/10) — cap forced to <b>{d.modeledCap}</b>. Stop feeding
            fresh not-helpful notes.
          </>
        )}
      </div>
    </div>
  );
}
