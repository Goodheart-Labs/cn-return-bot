import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLoginPrompt } from "@cn/features/auth/loginPrompt";
import { fetchItemForUrl } from "@cn/core/items";
import { ALL_FEATURES } from "@cn/core/minisiteFeatures";
import {
  createMinisite, fetchMinisiteJob, requestPageRead, slugForTitle, subscribeToMinisiteJob, VALID_SLUG, type PageReadResult,
} from "@cn/core/minisites";
import { fetchNotesForItem } from "@cn/core/notes";
import { fetchPassageHighlights } from "@cn/core/passages";
import { parseReaderText } from "@cn/core/readerText";
import { Button } from "@cn/ui/Button";
import { Input, Textarea } from "@cn/ui/Field";
import { RouteLink } from "../../components/RouteLink";
import { MINISITES, type Route } from "../../lib/routing";
import { useIsAdmin } from "../../lib/useIsAdmin";
import { BlockContent } from "../../reader/Blocks";
import { FeatureChecklist } from "./FeatureChecklist";
import "../../reader/reader.css";
import "./minisites.css";

/** How often an unfinished job is checked, in case the realtime update is missed. */
const JOB_POLL_MS = 3000;
/** Reading a page normally takes a few seconds. After this long without an
 *  answer, the flow says so instead of waiting silently. */
const PAGE_READ_TIMEOUT_MS = 45_000;

type Step = "paste" | "check" | "features";

const STEPS: { id: Step; label: string }[] = [
  { id: "paste", label: "Paste a link" },
  { id: "check", label: "Check what we found" },
  { id: "features", label: "Choose features" },
];

function webAddress(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** The page-read job, refreshed when the intake service writes its result. */
function usePageRead(jobId: string | null) {
  const query = useQuery({
    queryKey: ["minisiteJob", jobId],
    queryFn: () => fetchMinisiteJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === "done" || q.state.data?.status === "error" ? false : JOB_POLL_MS),
  });
  const { refetch } = query;
  useEffect(() => (jobId ? subscribeToMinisiteJob(jobId, () => { void refetch(); }) : undefined), [jobId, refetch]);
  return query.data ?? null;
}

/** What Common Notes already has on the page, so the admin knows it carries over. */
function useKnownPage(url: string | null) {
  return useQuery({
    queryKey: ["knownPage", url],
    enabled: !!url,
    queryFn: async () => {
      const item = await fetchItemForUrl(url!);
      if (!item) return null;
      const [notes, highlights] = await Promise.all([fetchNotesForItem(item.id), fetchPassageHighlights(item.id)]);
      const known = { checked: item.checked_scope === "page" && item.status === "done", notes: notes.length, highlights: highlights.length };
      // An article row with nothing on it, for example one left behind by a
      // deleted minisite, is not worth a line.
      return known.checked || known.notes || known.highlights ? known : null;
    },
  }).data ?? null;
}

function Steps({ current }: { current: Step }) {
  const index = STEPS.findIndex((step) => step.id === current);
  return <ol className="create-steps" aria-label="Steps">
    {STEPS.map((step, i) => <li key={step.id} className={i === index ? "create-step-current" : i < index ? "create-step-done" : ""} aria-current={i === index ? "step" : undefined}>
      <span aria-hidden="true">{i < index ? "✓" : i + 1}</span>{step.label}
    </li>)}
  </ol>;
}

function Preview({ result }: { result: PageReadResult }) {
  const blocks = useMemo(() => parseReaderText(result.content), [result.content]);
  return <div className="create-preview" role="region" aria-label="The text as readers will see it">
    {result.image_url && <img className="create-preview-image" src={result.image_url} alt="" referrerPolicy="no-referrer" />}
    {blocks.map((block) => <div key={block.id} className="reader-passage"><BlockContent block={block} quotes={[]} scope="preview" /></div>)}
  </div>;
}

/** Creating a minisite from a pasted link. Only admins reach the form; the
 *  database refuses everyone else anyway. */
export function CreateMinisitePage({ navigate }: { navigate: (route: Route) => void }) {
  const admin = useIsAdmin();
  const openLogin = useLoginPrompt();
  const client = useQueryClient();
  const [address, setAddress] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState("");
  const [step, setStep] = useState<Step>("paste");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [features, setFeatures] = useState<string[]>([...ALL_FEATURES]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const job = usePageRead(jobId);
  const result = job?.status === "done" ? (job.result as unknown as PageReadResult) : null;
  const known = useKnownPage(result && job ? job.url : null);
  const reading = !!jobId && (!job || job.status === "pending" || job.status === "running");
  const [slowJob, setSlowJob] = useState<string | null>(null);
  useEffect(() => {
    if (!jobId) return;
    const timer = setTimeout(() => setSlowJob(jobId), PAGE_READ_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [jobId]);
  const unanswered = reading && slowJob === jobId;

  // When the page has been read, its title and description fill the form once.
  // Setting state while rendering is React's pattern for state derived from a
  // change; it runs a single extra render and no effect.
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  if (result && job && filledFrom !== job.id) {
    setFilledFrom(job.id);
    // Results read before the page reader collapsed line breaks still carry them.
    setTitle(result.title.replace(/\s+/g, " ").trim());
    setDescription(result.description.replace(/\s+/g, " ").trim());
    setSlug(slugForTitle(result.title));
    setSlugEdited(false);
    setStep("check");
  }

  if (!admin) return <main className="minisites-page"><h1>Create a minisite</h1><p className="minisites-empty">Only admins can create minisites. Sign in with an admin email address to continue.</p><Button className="mt-4" onClick={openLogin}>Sign in</Button></main>;

  async function read() {
    const url = webAddress(address);
    if (!url) { setRequestError("Paste the full address, starting with https://."); return; }
    setRequestError("");
    try {
      setJobId(await requestPageRead(url));
    } catch {
      setRequestError("The request didn't save. Check your connection and try again.");
    }
  }
  async function create() {
    if (!jobId) return;
    setCreating(true);
    setCreateError("");
    try {
      const created = await createMinisite({ jobId, slug, title, description, features });
      await client.invalidateQueries({ queryKey: ["minisites"] });
      navigate({ view: "minisites", slug: created });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "The minisite could not be created.");
    } finally {
      setCreating(false);
    }
  }
  const slugValid = VALID_SLUG.test(slug) && slug !== "new";

  return <main className="minisites-page create-page">
    <p className="create-back"><RouteLink to={MINISITES} navigate={navigate}>← All minisites</RouteLink></p>
    <h1>Create a minisite</h1>
    <Steps current={step} />

    {step === "paste" && <form className="create-paste" onSubmit={(event) => { event.preventDefault(); void read(); }}>
      <label htmlFor="create-address">Article address</label>
      <div className="create-paste-row">
        <Input id="create-address" type="url" inputMode="url" autoFocus placeholder="https://" value={address} onChange={(event) => { setAddress(event.target.value); setJobId(null); }} />
        <Button type="submit" disabled={reading || !address.trim()}>{reading ? "Reading the page…" : "Read the page"}</Button>
      </div>
      {requestError && <p role="alert" className="factcheck-error">{requestError}</p>}
      {unanswered && <p role="alert" className="factcheck-error">The page reader hasn't answered. It may be restarting. <button type="button" className="minisites-retry" onClick={() => void read()}>Try again</button></p>}
      {job?.status === "error" && <p role="alert" className="factcheck-error">{job.error ?? "We couldn't read this page."} <button type="button" className="minisites-retry" onClick={() => void read()}>Try again</button></p>}
    </form>}

    {step === "check" && result && <section className="create-check">
      {known && <p className="create-known">This page is already on Common Notes: {known.notes} {known.notes === 1 ? "note" : "notes"}, {known.highlights} {known.highlights === 1 ? "key point or forecast" : "key points and forecasts"}{known.checked ? ", fact-checked" : ""}.</p>}
      <div className="create-columns">
        <div className="create-fields">
          <label htmlFor="create-title">Title</label>
          <Input id="create-title" value={title} maxLength={300} onChange={(event) => { setTitle(event.target.value); if (!slugEdited) setSlug(slugForTitle(event.target.value)); }} />
          <label htmlFor="create-description">Description</label>
          <Textarea id="create-description" autoGrow rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} />
          <label htmlFor="create-slug">Address</label>
          <div className="create-slug"><span>commonnotes.net/minisites/</span><Input id="create-slug" value={slug} maxLength={80} aria-invalid={!slugValid} onChange={(event) => { setSlug(event.target.value.toLowerCase()); setSlugEdited(true); }} /></div>
          {!slugValid && <p className="factcheck-error">Use lowercase letters, numbers and dashes.</p>}
          {result.byline && <><p className="create-field-label">Byline</p><p className="create-byline">{result.byline}</p></>}
        </div>
        <Preview result={result} />
      </div>
      <div className="minisite-dialog-actions">
        <Button variant="quiet" onClick={() => { setStep("paste"); setJobId(null); }}>Start over</Button>
        <Button disabled={!title.trim() || !slugValid} onClick={() => setStep("features")}>Next: choose features</Button>
      </div>
    </section>}

    {step === "features" && <section className="create-features">
      <FeatureChecklist value={features} onChange={setFeatures} />
      {createError && <p role="alert" className="factcheck-error">{createError}</p>}
      <div className="minisite-dialog-actions">
        <Button variant="quiet" onClick={() => setStep("check")}>Back</Button>
        <Button disabled={creating} onClick={() => void create()}>{creating ? "Creating…" : "Create minisite"}</Button>
      </div>
    </section>}
  </main>;
}
