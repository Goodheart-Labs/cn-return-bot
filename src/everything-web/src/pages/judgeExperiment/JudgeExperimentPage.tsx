import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchReviewDrafts, type ReviewDraft } from "@cn/core/claudeReview";
import { cn } from "@cn/ui/cn";
import { ResizablePanel } from "@cn/ui/ResizablePanel";
import { RouteLink } from "../../components/RouteLink";
import type { Route } from "../../lib/routing";
import { useAdminStatus } from "../../lib/useIsAdmin";
import { ReviewCard } from "../noteReview/ReviewCard";
import { useLiveNotes, withSourceDetails } from "../noteReview/reviewQueries";
import { JUDGE_SECTIONS, type JudgeSection } from "./sections";

/* The note judge experiment (GOO-588), on a page that exists only on the
 * development server. It shows the labelled notes of the experiment as the
 * review page shows drafts. The labels and the judges' answers come from the
 * experiment's data files in src/scripts_jim/2026_10_26_note_judge/data/,
 * which the development server serves. The drafts and their live votes come
 * from the same admin functions the review page calls. */

const DATA_URL = "/__scripts_jim/2026_10_26_note_judge/data";
/** The database function returns at most this many drafts per call. */
const MAX_DRAFTS_PER_CALL = 50;
const SIDEBAR_WIDTH = { default: 280, min: 220, max: 420 };

const SECTION_TITLES: Record<JudgeSection, string> = {
  helpful: "Helpful",
  not_helpful: "Not helpful",
  examples: "Few-shot examples",
};
const SECTION_DESCRIPTIONS: Record<JudgeSection, string> = {
  helpful: "Rated helpful overall, or Helpful or Somewhat helpful votes and no Not-helpful vote. The author's own automatic vote does not count.",
  not_helpful: "Rejected by Jim or Nathan, rated not helpful overall, or Not-helpful votes and no Helpful or Somewhat helpful vote.",
  examples: "The older half of the labelled notes. The few-shot judge sees these in its prompt, oldest first, and judges only the newer half.",
};
const OUTCOME_LABELS = { helpful: "Helpful", not_helpful: "Not helpful" } as const;

interface LabelledNote {
  draftId: string;
  outcome: "helpful" | "not_helpful";
  labelWhy: string;
  reason: string | null;
  fewShotRole: "example" | "judged";
}
interface JudgeResult {
  draftId: string;
  pHelpful: number;
  pImpactful: number;
  reasoning: string;
}
type Mode = "zero" | "few";

async function fetchDataset(): Promise<LabelledNote[]> {
  const response = await fetch(`${DATA_URL}/dataset.json`);
  if (!response.ok) throw new Error("The dataset is missing. Run buildDataset.ts first.");
  return response.json();
}

/** One run's answers by draft. A run that has not started has no file. */
async function fetchResults(mode: Mode): Promise<Map<string, JudgeResult>> {
  const response = await fetch(`${DATA_URL}/${mode}.jsonl`);
  if (response.status === 404) return new Map();
  if (!response.ok) throw new Error(`Could not read the ${mode}-shot results`);
  const lines = (await response.text()).split("\n").filter(Boolean);
  return new Map(lines.map((line) => JSON.parse(line) as JudgeResult).map((r) => [r.draftId, r]));
}

const inSection = (section: JudgeSection) => (n: LabelledNote) =>
  section === "examples" ? n.fewShotRole === "example" : n.outcome === section;

/** The section's drafts, in the dataset's order: oldest first. */
function useSectionDrafts(notes: LabelledNote[] | undefined) {
  const client = useQueryClient();
  const ids = notes?.map((n) => n.draftId) ?? [];
  return useQuery({
    queryKey: ["judgeExperiment", "drafts", ...ids],
    queryFn: async () => {
      const chunks = Array.from({ length: Math.ceil(ids.length / MAX_DRAFTS_PER_CALL) }, (_, i) => ids.slice(i * MAX_DRAFTS_PER_CALL, (i + 1) * MAX_DRAFTS_PER_CALL));
      const drafts = withSourceDetails(client, (await Promise.all(chunks.map(fetchReviewDrafts))).flat());
      const byId = new Map(drafts.map((d) => [d.id, d]));
      return ids.flatMap((id) => byId.get(id) ?? []);
    },
    enabled: ids.length > 0,
  });
}

function JudgeAnswer({ mode, result }: { mode: Mode; result: JudgeResult | undefined }) {
  if (!result) return null;
  return (
    <details>
      <summary className="cursor-pointer">
        {mode === "zero" ? "Zero-shot" : "Few-shot"} judge: P(helpful) {result.pHelpful.toFixed(2)}, P(impactful) {result.pImpactful.toFixed(2)}
      </summary>
      <p className="mt-1 whitespace-pre-wrap">{result.reasoning}</p>
    </details>
  );
}

/** What the experiment knows about the note: its label, its part in the
 *  few-shot run, and the judges' answers once the runs have them. */
function ExperimentFacts({ note, results }: { note: LabelledNote; results: Record<Mode, Map<string, JudgeResult>> }) {
  return (
    <div className="space-y-1 rounded-control border border-line p-3 text-sm text-fg-secondary">
      <p>
        <span className={cn("font-medium", note.outcome === "helpful" ? "text-positive" : "text-negative")}>{OUTCOME_LABELS[note.outcome]}</span>
        {`: ${note.labelWhy}. Few-shot ${note.fewShotRole === "example" ? "example" : "test note"}.`}
      </p>
      {note.reason && <p className="text-xs text-fg-muted">Reason: {note.reason}</p>}
      <JudgeAnswer mode="zero" result={results.zero.get(note.draftId)} />
      <JudgeAnswer mode="few" result={results.few.get(note.draftId)} />
    </div>
  );
}

function SectionFeed({ notes, results }: { notes: LabelledNote[]; results: Record<Mode, Map<string, JudgeResult>> }) {
  const drafts = useSectionDrafts(notes);
  const liveNotes = useLiveNotes(drafts.data ?? []);
  const noteById = new Map(notes.map((n) => [n.draftId, n]));
  if (drafts.isError) return <p className="mx-auto max-w-[40rem] text-sm text-negative">{drafts.error.message}</p>;
  if (!drafts.data) return <p className="mx-auto max-w-[40rem] text-sm text-fg-muted">Loading…</p>;
  return (
    <div className="space-y-6">
      {drafts.data.map((draft: ReviewDraft) => (
        <ReviewCard
          key={draft.id}
          draft={draft}
          liveNote={draft.noteId ? liveNotes?.get(draft.noteId) : undefined}
          extra={<ExperimentFacts note={noteById.get(draft.id)!} results={results} />}
        />
      ))}
    </div>
  );
}

function SectionList({ current, counts, navigate }: { current: JudgeSection; counts: Record<JudgeSection, number> | undefined; navigate: (route: Route) => void }) {
  return (
    <nav aria-label="Sections">
      <ul className="space-y-0.5">
        {JUDGE_SECTIONS.map((section) => (
          <li key={section}>
            <RouteLink
              to={{ view: "judgeExperiment", section }}
              navigate={navigate}
              current={section === current}
              className={cn(
                "flex items-center justify-between gap-3 rounded-control px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                section === current ? "bg-tint font-medium text-fg" : "text-fg-secondary hover:bg-surface-hover hover:text-fg",
              )}
            >
              {SECTION_TITLES[section]}
              {counts && <span className="min-w-6 rounded-full bg-surface-muted px-1.5 py-0.5 text-center text-xs tabular-nums text-fg-secondary">{counts[section]}</span>}
            </RouteLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The labelled notes of the note judge experiment, one section at a time,
 *  for admins on the development server. */
export function JudgeExperimentPage({ section, navigate }: { section: JudgeSection; navigate: (route: Route) => void }) {
  const status = useAdminStatus();
  const dataset = useQuery({ queryKey: ["judgeExperiment", "dataset"], queryFn: fetchDataset });
  const zero = useQuery({ queryKey: ["judgeExperiment", "results", "zero"], queryFn: () => fetchResults("zero") });
  const few = useQuery({ queryKey: ["judgeExperiment", "results", "few"], queryFn: () => fetchResults("few") });
  if (status === "loading") return <p className="px-8 py-10 text-sm text-fg-muted">Loading…</p>;
  if (status === "not_admin") return <p className="mx-auto max-w-xl px-4 py-10 text-sm text-fg-secondary">This page is for admins. Sign in with an admin account to see it.</p>;
  const counts = dataset.data && (Object.fromEntries(JUDGE_SECTIONS.map((s) => [s, dataset.data.filter(inSection(s)).length])) as Record<JudgeSection, number>);
  const results = zero.data && few.data ? { zero: zero.data, few: few.data } : undefined;
  return (
    <div className="md:flex">
      <ResizablePanel
        storageKey="cn:judgeExperimentSidebarWidth"
        label="sidebar"
        defaultWidth={SIDEBAR_WIDTH.default}
        minWidth={SIDEBAR_WIDTH.min}
        maxWidth={SIDEBAR_WIDTH.max}
        className="hidden bg-surface md:block md:sticky md:top-14 md:h-[calc(100vh-3.5rem)]"
      >
        <div className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
          <h1 className="px-3 font-title text-lg font-bold text-fg">Note judge experiment</h1>
          <SectionList current={section} counts={counts} navigate={navigate} />
        </div>
      </ResizablePanel>
      <main className="min-w-0 flex-1 px-4 py-8 md:px-8">
        <div className="mx-auto mb-6 max-w-[40rem] space-y-2">
          <h2 className="font-title text-2xl font-bold text-fg">{SECTION_TITLES[section]}</h2>
          <p className="text-sm text-fg-secondary">{SECTION_DESCRIPTIONS[section]} Oldest first.</p>
        </div>
        {dataset.isError && <p className="mx-auto max-w-[40rem] text-sm text-negative">{dataset.error.message}</p>}
        {dataset.data && results && <SectionFeed key={section} notes={dataset.data.filter(inSection(section))} results={results} />}
      </main>
    </div>
  );
}
