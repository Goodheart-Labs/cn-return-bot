import { useState } from "react";
import { noteStatus } from "@cn/core/noteScore";
import { NoteBox } from "@cn/features/notes/NoteBox";
import { VoteRatings } from "@cn/features/notes/VoteRatings";
import { cn } from "@cn/ui/cn";
import type { LabClaim, LabNote } from "../../labRun";
import { toNoteRow } from "./data";

const OUTCOME_LABEL: Record<LabClaim["outcome"]["type"], string> = {
  note: "Checked, note written",
  no_note: "Checked, no note",
  skipped: "Not checked, rated true enough",
  error: "Check failed",
  unchecked: "Never checked",
  check_skipped: "Worth checking, but this run did no checks",
};

const money = (usd: number) => `$${usd.toFixed(3)}`;

/** The pipeline's reason codes for a checked claim without a note, in words. */
const NO_NOTE_REASON: Record<string, string> = {
  no_correction_needed: "The research found nothing that needs a note.",
  check_failed: "A note was drafted, but the source check found its sources do not back it.",
  unfetchable_sources: "A note was drafted, but none of its sources could be opened.",
  low_materiality_score: "A note was drafted, but it was judged not important enough to show.",
};

/** Why the claim ended where it did. A claim skipped for its rating only
 *  repeats the rating, which the header already shows, so it has none. */
function outcomeDetail(claim: LabClaim): string | null {
  const { outcome } = claim;
  if (outcome.type === "skipped" && outcome.reason === `judged ${claim.judgement}`) return null;
  if (outcome.type === "no_note" || outcome.type === "skipped") return NO_NOTE_REASON[outcome.reason] ?? (outcome.reason || null);
  if (outcome.type === "error") return outcome.error;
  return null;
}

/** The draft a claim check threw away, and the research behind any check.
 *  The research is long, so it opens on demand. */
function TraceDetails({ claim }: { claim: LabClaim }) {
  const [researchOpen, setResearchOpen] = useState(false);
  const { trace } = claim;
  if (!trace) return null;
  const discardedDraft = claim.notes.length === 0 ? trace.draftNote : null;
  return (
    <div className="text-xs space-y-2">
      {discardedDraft && (
        <div className="rounded-control border border-dashed border-line-strong p-2">
          <p className="font-semibold text-fg-secondary mb-1">Drafted note, not published</p>
          <p className="text-fg whitespace-pre-wrap [overflow-wrap:anywhere]">{discardedDraft}</p>
          {trace.sourceVerdict && trace.sourceVerdict !== "YES" && (
            <p className="mt-1 text-fg-muted">Source check: {trace.sourceVerdict.toLowerCase()}</p>
          )}
        </div>
      )}
      {trace.research && (
        <div>
          <button type="button" className="text-fg-muted hover:text-fg underline" onClick={(e) => {
            e.stopPropagation();
            setResearchOpen((open) => !open);
          }}>
            {researchOpen ? "Hide what the research found" : "Show what the research found"}
          </button>
          {researchOpen && <p className="mt-1 text-fg-secondary whitespace-pre-wrap [overflow-wrap:anywhere]">{trace.research}</p>}
        </div>
      )}
    </div>
  );
}

/** What the pipeline decided about the claim, above its notes: the rater's
 *  judgement, the outcome and its reason, the topic part and the check's cost. */
function ClaimHeader({ claim }: { claim: LabClaim }) {
  const detail = outcomeDetail(claim);
  return (
    <div className="text-xs text-fg-secondary space-y-1">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span className="font-semibold text-fg">{OUTCOME_LABEL[claim.outcome.type]}</span>
        <span>Rated: {claim.judgement}</span>
        {claim.checkCostUsd !== null && <span>Check: {money(claim.checkCostUsd)}</span>}
      </div>
      <p className="text-fg-muted">
        <span className="font-medium">Claim:</span> {claim.claim}
      </p>
      {detail && (
        <p className="text-fg-muted">
          <span className="font-medium">Why:</span> {detail}
        </p>
      )}
      {claim.part && <p className="text-fg-subtle">Part: {claim.part}</p>}
    </div>
  );
}

/** One note in the shared note card. Votes only exist in production, so the
 *  rating pills show the counts there and are left out for local runs. */
function LabNoteCard({ note, claim, showVotes }: { note: LabNote; claim: LabClaim; showVotes: boolean }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const row = toNoteRow(note, claim);
  const hasDetails = row.has_source_details;
  return (
    <div>
      <NoteBox note={row} status={noteStatus(row)} sourcesOpen={sourcesOpen}>
        {showVotes && (
          <VoteRatings
            helpful={note.votes.helpful}
            somewhatHelpful={note.votes.somewhatHelpful}
            notHelpful={note.votes.notHelpful}
            showCounts
            onVote={() => {}}
          />
        )}
      </NoteBox>
      <div className="mt-1 flex gap-3 text-xs text-fg-muted">
        <span>{note.isAi ? "AI note" : `Reader note${note.status === "draft" ? " (draft)" : ""}`}</span>
        {hasDetails && (
          <button type="button" className="hover:text-fg underline" onClick={() => setSourcesOpen((open) => !open)}>
            {sourcesOpen ? "Hide source details" : "Show source details"}
          </button>
        )}
      </div>
    </div>
  );
}

/** A claim in the margin: its header and every note written on it, followed
 *  by the readers' arguments that it needs no note. */
export function ClaimCard({ claim, showVotes, selected, onSelect, onClose }: {
  claim: LabClaim;
  showVotes: boolean;
  selected: boolean;
  onSelect: () => void;
  /** Set for a card that only shows because its passage was clicked. */
  onClose?: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "rounded-card border bg-surface p-3 space-y-3 shadow-raised cursor-default",
        selected ? "border-caution-solid ring-2 ring-caution-solid" : "border-line",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <ClaimHeader claim={claim} />
        </div>
        {onClose && (
          <button type="button" aria-label="Close" className="text-fg-muted hover:text-fg text-sm leading-none" onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}>
            ✕
          </button>
        )}
      </div>
      <TraceDetails claim={claim} />
      {claim.notes.map((note) => (
        <LabNoteCard key={note.id} note={note} claim={claim} showVotes={showVotes} />
      ))}
      {claim.notNeeded.map((entry) => (
        <div key={entry.id} className="rounded-control border border-line p-2 text-sm">
          <p className="text-xs font-semibold text-fg-secondary mb-1">Note not needed{entry.author ? `, by ${entry.author}` : ""}</p>
          <p>{entry.body}</p>
        </div>
      ))}
    </div>
  );
}
