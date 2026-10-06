import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isWholePageChecked } from "@cn/core/items";
import { enabledFeatures } from "@cn/core/minisiteFeatures";
import { fetchMinisite, startMinisiteCheck, updateMinisiteFeatures, type Minisite } from "@cn/core/minisites";
import { deriveRequestProgress, progressIsTerminal, progressLines } from "@cn/core/requestProgress";
import { fetchProgressClaimRows, fetchProgressItemRow, subscribeToItemProgress } from "@cn/core/requestStatus";
import { Button } from "@cn/ui/Button";
import { Modal } from "@cn/ui/Modal";
import { RouteLink } from "../../components/RouteLink";
import { MINISITES, type Route } from "../../lib/routing";
import { useIsAdmin } from "../../lib/useIsAdmin";
import { Reader } from "../../reader/Reader";
import { FeatureChecklist } from "./FeatureChecklist";
import "./minisites.css";

/** The live state of the article's fact-check, read the same way the
 *  extension's progress card reads it. */
function useCheckProgress(itemId: string, watching: boolean) {
  const query = useQuery({
    queryKey: ["minisiteCheck", itemId],
    queryFn: async () => deriveRequestProgress(await fetchProgressItemRow(itemId), await fetchProgressClaimRows(itemId), null),
    enabled: watching,
  });
  const { refetch } = query;
  useEffect(() => {
    if (!watching) return;
    return subscribeToItemProgress(itemId, () => { void refetch(); }, () => { void refetch(); });
  }, [itemId, watching, refetch]);
  return query.data ?? null;
}

/** The sheet an admin sees on a minisite whose article has not been
 *  fact-checked. It is the browser's own <dialog>, opened as a modal, so the
 *  page behind it dims, focus stays inside, and Escape closes it. A click on
 *  the dimmed page closes it too. Closing hides it until the next visit. */
function FactCheckSheet({ minisite, onStarted, onClose }: { minisite: Minisite; onStarted: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function start() {
    setStarting(true);
    setError("");
    try {
      await startMinisiteCheck(minisite.id);
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The fact-check could not start. Please try again.");
    } finally {
      setStarting(false);
    }
  }
  return (
    // The dialog element only receives clicks on the dimmed area around the
    // sheet. Keyboard users close it with Escape, which the browser reports
    // through onClose.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog ref={dialog} className="factcheck-sheet" aria-labelledby="factcheck-title" onClose={onClose}
      onMouseDown={(event) => { pressedOnBackdrop.current = event.target === event.currentTarget; }}
      onClick={(event) => { if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
      <p className="factcheck-admin">Only admins see this</p>
      <h2 id="factcheck-title">Fact-check this article</h2>
      <p>The AI pipeline finds the factual claims, checks the doubtful ones against sources and writes a note where a claim needs context. Notes appear in the margin as they are written, usually within ten minutes.</p>
      <p>Articles cost about $0.05 to $0.20 in the last week, and at most about $1. It comes out of the $25 a day kept for reader requests.</p>
      {error && <p role="alert" className="factcheck-error">{error}</p>}
      <div className="factcheck-actions"><Button autoFocus disabled={starting} onClick={() => void start()}>{starting ? "Starting…" : "Run the fact-check"}</Button></div>
    </dialog>
  );
}

/** How long the pill stays on screen after the fact-check finished. */
const FINISHED_PILL_MS = 6000;

/** The pill at the bottom of the page while the fact-check runs. It hides
 *  itself a few seconds after the check finished. */
function CheckProgressPill({ itemId, onFinished }: { itemId: string; onFinished: () => void }) {
  const progress = useCheckProgress(itemId, true);
  const finished = !!progress && progressIsTerminal(progress);
  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(onFinished, FINISHED_PILL_MS);
    return () => clearTimeout(timer);
  }, [finished, onFinished]);
  if (!progress) return null;
  return <p className="factcheck-progress" role="status" aria-live="polite">
    {finished ? `Fact-check finished: ${progressLines(progress).join(", ")}` : `Fact-check · ${progressLines(progress).join(" · ")}`}
  </p>;
}

function EditFeaturesDialog({ minisite, onClose }: { minisite: Minisite; onClose: () => void }) {
  const client = useQueryClient();
  const [features, setFeatures] = useState<string[]>(minisite.features);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    setError("");
    try {
      await updateMinisiteFeatures(minisite.id, features);
      await client.invalidateQueries({ queryKey: ["minisite", minisite.slug] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The features could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  return <Modal title="Edit features" onClose={onClose} widthClassName="max-w-[40rem]">
    <FeatureChecklist value={features} onChange={setFeatures} />
    {error && <p role="alert" className="factcheck-error">{error}</p>}
    <div className="minisite-dialog-actions">
      <Button variant="quiet" onClick={onClose}>Cancel</Button>
      <Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save features"}</Button>
    </div>
  </Modal>;
}

/** One minisite: its article in the reader, with the features it switched on.
 *  Admins also get Edit features, and the fact-check sheet while the article
 *  is unchecked. */
export function MinisitePage({ slug, navigate }: { slug: string; navigate: (route: Route) => void }) {
  const admin = useIsAdmin();
  const query = useQuery({ queryKey: ["minisite", slug], queryFn: () => fetchMinisite(slug) });
  const [sheetClosed, setSheetClosed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [checkStarted, setCheckStarted] = useState(false);
  const [pillDone, setPillDone] = useState(false);
  const item = query.data?.item;
  const running = !!item && (item.status === "queued" || item.status === "processing");
  const hidePill = useCallback(() => { setPillDone(true); void query.refetch(); }, [query]);

  if (query.isPending) return <main className="minisites-page"><p className="minisites-empty" role="status">Loading the minisite…</p></main>;
  if (query.isError) return <main className="minisites-page"><p className="minisites-empty" role="alert">The minisite couldn't load. <button type="button" className="minisites-retry" onClick={() => void query.refetch()}>Try again</button></p></main>;
  if (!query.data) return <main className="minisites-page"><h1>No minisite here</h1><p className="minisites-empty">There is no minisite at this address. <RouteLink to={MINISITES} navigate={navigate} className="minisites-retry">See all minisites</RouteLink></p></main>;

  const { minisite } = query.data;
  const unchecked = !isWholePageChecked(query.data.item) && !running && !checkStarted;
  return <>
    {admin && <div className="minisite-admin-bar"><Button variant="secondary" onClick={() => setEditing(true)}>Edit features</Button></div>}
    <Reader key={minisite.updated_at} item={query.data.item} content={minisite.content} scope="main" features={enabledFeatures(minisite.features)}
      header={{ title: minisite.title, description: minisite.description, byline: minisite.byline, publishedAt: minisite.published_at }} />
    {admin && unchecked && !sheetClosed && <FactCheckSheet minisite={minisite} onClose={() => setSheetClosed(true)} onStarted={() => { setCheckStarted(true); void query.refetch(); }} />}
    {admin && (running || checkStarted) && !pillDone && <CheckProgressPill itemId={minisite.item_id} onFinished={hidePill} />}
    {editing && <EditFeaturesDialog minisite={minisite} onClose={() => setEditing(false)} />}
  </>;
}
