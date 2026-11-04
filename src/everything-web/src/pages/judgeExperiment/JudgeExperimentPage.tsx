import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchReviewDrafts, type ReviewDraft } from "@cn/core/claudeReview";
import { cn } from "@cn/ui/cn";
import { RouteLink } from "../../components/RouteLink";
import { SidebarLayout, sidebarEntry } from "../../components/SidebarLayout";
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

const SECTION_TITLES: Record<JudgeSection, string> = {
  results: "Results",
  helpful: "Helpful",
  not_helpful: "Not helpful",
  examples: "Few-shot examples",
  judged: "Few-shot test notes",
};
/** The note sections, which list notes. Results is the other one. */
type NoteSection = Exclude<JudgeSection, "results">;
const SECTION_DESCRIPTIONS: Record<JudgeSection, string> = {
  results: "How well each run's P(helpful) matches the labels. Run score.ts after copying the runs' answers into the data folder.",
  helpful: "Rated helpful overall, or Helpful or Somewhat helpful votes and no Not-helpful vote. The author's own automatic vote does not count.",
  not_helpful: "Rejected by Jim or Nathan, rated not helpful overall, or Not-helpful votes and no Helpful or Somewhat helpful vote.",
  examples: "The older half of the labelled notes. The few-shot judge sees these in its prompt, oldest first, and judges only the newer half.",
  judged: "The newer half of the labelled notes. Both experiments judged these, so their answers can be compared here.",
};
const NOTE_SECTIONS = JUDGE_SECTIONS.filter((s): s is NoteSection => s !== "results");
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
/** Each prompt's results sit in the data folder under its own file prefix.
 *  The newest prompt comes first. Prompt 3 was tried on only two notes, so it
 *  has no scores. */
const PROMPTS = [
  { prefix: "v4-", title: "Prompt 4, Jim's flow chart", scored: true },
  { prefix: "v3-", title: "Prompt 3, with the most favourable reading", scored: false },
  { prefix: "v2-", title: "Prompt 2, with the reader guidance", scored: true },
  { prefix: "v1-", title: "Prompt 1, the original", scored: true },
] as const;
type Prompt = (typeof PROMPTS)[number];
type RunResults = Record<Mode, Map<string, JudgeResult>> & { prompt: Prompt };

async function fetchDataset(): Promise<LabelledNote[]> {
  const response = await fetch(`${DATA_URL}/dataset.json`);
  if (!response.ok) throw new Error("The dataset is missing. Run buildDataset.ts first.");
  return response.json();
}

/** One run's answers by draft. A run that has not started has no file. */
async function fetchResults(prefix: string, mode: Mode): Promise<Map<string, JudgeResult>> {
  const response = await fetch(`${DATA_URL}/${prefix}${mode}.jsonl`);
  if (response.status === 404) return new Map();
  if (!response.ok) throw new Error(`Could not read the ${mode}-shot results`);
  const lines = (await response.text()).split("\n").filter(Boolean);
  return new Map(lines.map((line) => JSON.parse(line) as JudgeResult).map((r) => [r.draftId, r]));
}

const inSection = (section: NoteSection) => (n: LabelledNote) =>
  section === "examples" ? n.fewShotRole === "example" : section === "judged" ? n.fewShotRole === "judged" : n.outcome === section;

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
function ExperimentFacts({ note, results }: { note: LabelledNote; results: RunResults[] }) {
  return (
    <div className="space-y-1 rounded-control border border-line p-3 text-sm text-fg-secondary">
      <p>
        <span className={cn("font-medium", note.outcome === "helpful" ? "text-positive" : "text-negative")}>{OUTCOME_LABELS[note.outcome]}</span>
        {`: ${note.labelWhy}. Few-shot ${note.fewShotRole === "example" ? "example" : "test note"}.`}
      </p>
      {note.reason && <p className="text-xs text-fg-muted">Reason: {note.reason}</p>}
      {results
        .filter(({ zero, few }) => zero.has(note.draftId) || few.has(note.draftId))
        .map(({ prompt, zero, few }) => (
        <div key={prompt.prefix} className="pt-1">
          <p className="text-xs text-fg-muted">{prompt.title}</p>
          <JudgeAnswer mode="zero" result={zero.get(note.draftId)} />
          <JudgeAnswer mode="few" result={few.get(note.draftId)} />
        </div>
      ))}
    </div>
  );
}

function SectionFeed({ notes, results }: { notes: LabelledNote[]; results: RunResults[] }) {
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

/** What score.ts writes to report.json. */
interface SetScore {
  title: string;
  notes: number;
  judged: number;
  helpful: number;
  notHelpful: number;
  auc: number;
  aucInterval: [number, number];
  brier: number;
  baselineBrier: number;
  meanPHelpful: { helpful: number; notHelpful: number };
  calibration: { low: number; high: number; notes: number; helpful: number }[];
}
interface RunCost {
  judges: number;
  usd: number;
  minutesEach: number;
}
interface Report {
  sets: SetScore[];
  cost: Record<Mode, RunCost>;
}

async function fetchReport(prefix: string): Promise<Report | null> {
  const response = await fetch(`${DATA_URL}/${prefix}report.json`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not read the report");
  return response.json();
}

function SetScoreCard({ score }: { score: SetScore }) {
  const [low, high] = score.aucInterval;
  return (
    <section className="space-y-3 rounded-card border border-line bg-surface p-4 text-sm text-fg-secondary">
      <h3 className="font-medium text-fg">{score.title}</h3>
      <p>
        {score.judged} of {score.notes} notes judged: {score.helpful} helpful, {score.notHelpful} not helpful.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          AUC {score.auc.toFixed(2)}, with a 95% interval from {low.toFixed(2)} to {high.toFixed(2)}. This is the chance that a random helpful note gets a higher P(helpful) than a random not-helpful one. 0.5 is guessing.
        </li>
        <li>
          Brier score {score.brier.toFixed(3)}, the mean squared error of P(helpful). Always guessing the share of helpful notes scores {score.baselineBrier.toFixed(3)}. Lower is better.
        </li>
        <li>
          Mean P(helpful): {score.meanPHelpful.helpful.toFixed(2)} on helpful notes, {score.meanPHelpful.notHelpful.toFixed(2)} on not-helpful notes.
        </li>
      </ul>
      <table className="w-full text-left tabular-nums">
        <thead className="text-xs text-fg-muted">
          <tr>
            <th className="py-1 font-normal">P(helpful)</th>
            <th className="py-1 font-normal">Notes</th>
            <th className="py-1 font-normal">Really helpful</th>
          </tr>
        </thead>
        <tbody>
          {score.calibration.map((bin) => (
            <tr key={bin.low} className="border-t border-line">
              <td className="py-1">
                {bin.low.toFixed(1)} to {bin.high.toFixed(1)}
              </td>
              <td className="py-1">{bin.notes}</td>
              <td className="py-1">
                {bin.helpful} ({Math.round((100 * bin.helpful) / bin.notes)}%)
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PromptResults({ prompt }: { prompt: Prompt }) {
  const report = useQuery({ queryKey: ["judgeExperiment", "report", prompt.prefix], queryFn: () => fetchReport(prompt.prefix) });
  if (report.isError) return <p className="text-sm text-negative">{report.error.message}</p>;
  if (report.isPending) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!report.data) return <p className="text-sm text-fg-muted">No report yet. Run score.ts first.</p>;
  const { sets, cost } = report.data;
  return (
    <div className="space-y-6">
      {sets.map((score) => (
        <SetScoreCard key={score.title} score={score} />
      ))}
      <p className="text-xs text-fg-muted">
        Every judge ran as Claude Code on Nathan's ai-box, on his Claude subscription. Nothing was billed. Zero-shot: {cost.zero.judges} judges,{" "}
        {cost.zero.minutesEach.toFixed(1)} minutes each. Few-shot: {cost.few.judges} judges, {cost.few.minutesEach.toFixed(1)} minutes each. Claude Code estimates the same
        tokens would cost ${(cost.zero.usd + cost.few.usd).toFixed(2)} on the API.
      </p>
    </div>
  );
}

/** The scored prompts side by side on wide screens, newest first. */
function Results() {
  return (
    <div className="mx-auto grid max-w-[40rem] gap-8 xl:max-w-[82rem] xl:grid-cols-2 2xl:max-w-[124rem] 2xl:grid-cols-3">
      {PROMPTS.filter((prompt) => prompt.scored).map((prompt) => (
        <section key={prompt.prefix} className="space-y-4">
          <h3 className="font-title text-lg font-bold text-fg">{prompt.title}</h3>
          <PromptResults prompt={prompt} />
        </section>
      ))}
    </div>
  );
}

function SectionList({ current, counts, navigate }: { current: JudgeSection; counts: Record<NoteSection, number> | undefined; navigate: (route: Route) => void }) {
  return (
    <nav aria-label="Sections">
      <ul className="space-y-0.5">
        {JUDGE_SECTIONS.map((section) => (
          <li key={section}>
            <RouteLink
              to={{ view: "judgeExperiment", section }}
              navigate={navigate}
              current={section === current}
              className={cn(sidebarEntry(section === current), "justify-between gap-3")}
            >
              {SECTION_TITLES[section]}
              {counts && section !== "results" && <span className="min-w-6 rounded-full bg-surface-muted px-1.5 py-0.5 text-center text-xs tabular-nums text-fg-secondary">{counts[section]}</span>}
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
  const runs = useQueries({
    queries: PROMPTS.map((prompt) => ({
      queryKey: ["judgeExperiment", "results", prompt.prefix],
      queryFn: async (): Promise<RunResults> => ({ prompt, zero: await fetchResults(prompt.prefix, "zero"), few: await fetchResults(prompt.prefix, "few") }),
    })),
  });
  if (status === "loading") return <p className="px-8 py-10 text-sm text-fg-muted">Loading…</p>;
  if (status === "not_admin") return <p className="mx-auto max-w-xl px-4 py-10 text-sm text-fg-secondary">This page is for admins. Sign in with an admin account to see it.</p>;
  const counts = dataset.data && (Object.fromEntries(NOTE_SECTIONS.map((s) => [s, dataset.data.filter(inSection(s)).length])) as Record<NoteSection, number>);
  const results = runs.every((run) => run.data) ? runs.map((run) => run.data!) : undefined;
  return (
    <SidebarLayout
      storageKey="cn:judgeExperimentSidebarWidth"
      sidebar={
        <div className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
          <h1 className="px-3 font-title text-lg font-bold text-fg">Note judge experiment</h1>
          <SectionList current={section} counts={counts} navigate={navigate} />
        </div>
      }
    >
      <div className="mx-auto mb-6 max-w-[40rem] space-y-2">
        <h2 className="font-title text-2xl font-bold text-fg">{SECTION_TITLES[section]}</h2>
        <p className="text-sm text-fg-secondary">{SECTION_DESCRIPTIONS[section]}{section !== "results" && " Oldest first."}</p>
      </div>
      {dataset.isError && <p className="mx-auto max-w-[40rem] text-sm text-negative">{dataset.error.message}</p>}
      {section === "results" ? (
        <Results />
      ) : (
        dataset.data && results && <SectionFeed key={section} notes={dataset.data.filter(inSection(section))} results={results} />
      )}
    </SidebarLayout>
  );
}
