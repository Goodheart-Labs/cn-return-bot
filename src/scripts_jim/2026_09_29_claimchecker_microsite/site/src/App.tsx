import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { totalCost, type LabRun, type RunIndexEntry, type Stage } from "../../labRun";
import { ArticleView } from "./ArticleView";
import { tintOf, type Tint } from "./anchoring";
import { seedSourceDetails, useArticle, useRun, useRunIndex } from "./data";

const LEGEND: { tint: Tint; label: string }[] = [
  { tint: "lab-note", label: "Has a note" },
  { tint: "lab-no-note", label: "Checked, no note" },
  { tint: "lab-skipped", label: "Not checked" },
  { tint: "lab-error", label: "Check failed" },
];

const money = (usd: number | null) => (usd === null ? "unknown" : `$${usd.toFixed(2)}`);

/** The run shown is kept in the address, so a reload stays on it. */
function useSelectedRunId(index: RunIndexEntry[] | undefined): [string | null, (id: string) => void] {
  const [runId, setRunId] = useState(() => new URLSearchParams(location.search).get("run"));
  useEffect(() => {
    if (!runId && index?.length) setRunId(index[index.length - 1]!.id);
  }, [index, runId]);
  const select = (id: string) => {
    history.replaceState(null, "", `?run=${id}`);
    setRunId(id);
  };
  return [runId, select];
}

function RunSummary({ run }: { run: LabRun }) {
  const count = (tint: Tint) => run.claims.filter((c) => tintOf(c) === tint).length;
  const notes = run.claims.flatMap((c) => c.notes);
  const readerNotes = notes.filter((n) => !n.isAi).length;
  const { extraction, rating, checks } = run.costUsd;
  const reused = (stage: Stage) => (run.basedOn?.reused.includes(stage) ? " (reused)" : "");
  return (
    <div className="text-sm text-fg-secondary space-y-1">
      <p>
        <span className="font-semibold text-fg">{money(totalCost(run))}</span> in total: extraction {money(extraction)}
        {reused("extraction")}, rating {money(rating)}
        {reused("rating")}, checks {money(checks)}.
        {run.basedOn && ` Reuses the ${run.basedOn.reused.join(" and ")} of run ${run.basedOn.runId}.`}
        {run.commit && ` Code at ${run.commit}.`}
      </p>
      <p>
        {run.claims.length} claims. {notes.length - readerNotes} AI notes
        {readerNotes > 0 && ` and ${readerNotes} reader notes`} on {count("lab-note")} claims. {count("lab-no-note")} checked without a note,{" "}
        {count("lab-skipped")} not checked, {count("lab-error")} failed.
      </p>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const article = useArticle();
  const index = useRunIndex();
  const [runId, selectRun] = useSelectedRunId(index.data);
  const run = useRun(runId);
  const [showAll, setShowAll] = useState(false);

  // The note cards read their source quotes from the cache, so the cache is
  // filled before the run renders.
  if (run.data) seedSourceDetails(queryClient, run.data);
  const error = article.error ?? index.error ?? run.error;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface px-6 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-semibold">Claimchecker lab</span>
          <select
            className="rounded-control border border-line bg-surface px-2 py-1 text-sm max-w-[32rem]"
            value={runId ?? ""}
            onChange={(e) => selectRun(e.target.value)}
          >
            {[...(index.data ?? [])].reverse().map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} · {new Date(entry.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} · ${entry.totalCostUsd.toFixed(2)} · {entry.notes} notes
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show claims without a note
          </label>
          <div className="flex flex-wrap gap-3 text-xs text-fg-secondary">
            {LEGEND.filter((l) => showAll || l.tint === "lab-note").map((l) => (
              <span key={l.tint} className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: `var(--${l.tint})` }} />
                {l.label}
              </span>
            ))}
          </div>
          {showAll && <span className="text-xs text-fg-muted">Click a tinted passage to see what the pipeline decided about it.</span>}
        </div>
        {run.data && <RunSummary run={run.data} />}
      </header>
      <main className="px-6 py-8 max-w-[76rem] mx-auto">
        {error && <p className="text-negative-solid">{String(error)}</p>}
        {article.data && run.data && <ArticleView article={article.data} run={run.data} showAll={showAll} />}
      </main>
    </div>
  );
}
