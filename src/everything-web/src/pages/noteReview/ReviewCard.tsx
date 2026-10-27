import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addToLeaderboard } from "@cn/core/bestNotes";
import {
  deleteDraftNote,
  explainVote,
  rewriteDraft,
  sendDraftMessage,
  skipDraft,
  voteOnWaitingDraft,
  type Reviewer,
  type ReviewDraft,
} from "@cn/core/claudeReview";
import { mintSelfVoteDonation } from "@cn/core/donations";
import { fetchNote } from "@cn/core/notes";
import { displayName } from "@cn/core/session";
import type { ClaimRef, FeedItemRow, NoteRow } from "@cn/core/types";
import type { Vote } from "@cn/core/votes";
import { useSession } from "@cn/features/auth/useSession";
import { Note } from "@cn/features/notes/Note";
import { NoteBox } from "@cn/features/notes/NoteBox";
import { useVoteOnNote } from "@cn/features/notes/useVotes";
import { VoteRatings } from "@cn/features/notes/VoteRatings";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { Textarea } from "@cn/ui/Field";
import { ClaimCard } from "../../components/ClaimCard";
import { noteUrl } from "../../lib/routing";
import { draftNoteId, dropDraft, refreshDrafts, waitsForClaude, type ReviewView } from "./reviewQueries";

const KIND_LABELS: Record<ReviewDraft["kind"], string> = {
  small_mistake: "Small mistake",
  missing_context: "Missing context",
  wrong_or_misleading: "Wrong or misleading",
};
const NO_NOTE_LABELS: Record<Exclude<ReviewDraft["outcome"], "note">, string> = {
  no_note_needed: "No note needed",
  too_hard: "Too hard to source",
  withdrawn: "Withdrawn by Claude",
};
export const PERSON: Record<Reviewer | "claude", string> = { jim: "Jim", nathan: "Nathan", claude: "Claude" };

/** Which of the note judge's two probabilities the reviewer chose to see. */
export interface JudgeShown {
  helpful: boolean;
  impactful: boolean;
}

const isNote = (draft: ReviewDraft) => draft.status !== "not_a_note";
const reviewOpen = (draft: ReviewDraft) => draft.verdict === null && (draft.status === "posted" || draft.status === "awaiting_approval");

function verdictText(draft: ReviewDraft): string {
  if (!draft.verdict) return "not reviewed yet";
  return `${draft.verdict} by ${PERSON[draft.reviewedBy ?? "jim"]}`;
}

function statusLine(draft: ReviewDraft): string {
  if (draft.status === "awaiting_approval") return "Waiting for approval";
  if (draft.status === "removed") return `Not on the site, ${verdictText(draft)}`;
  if (draft.status !== "posted") return NO_NOTE_LABELS[draft.outcome as Exclude<ReviewDraft["outcome"], "note">];
  const posted = !draft.postedAs || draft.postedAs === "ai" ? "Posted as an AI note" : `Posted by ${PERSON[draft.postedAs]}`;
  return `${posted}, ${verdictText(draft)}`;
}

/** The claim the card shows: the live note's own, or one made from the draft
 *  while the note is not on the site. */
function draftClaim(draft: ReviewDraft): ClaimRef {
  return {
    id: draftNoteId(draft),
    item_id: draft.itemId,
    claim: draft.claim,
    context_quote: draft.passage,
    context_paragraph: draft.contextParagraph,
    image_urls: [],
    updated_quote: null,
    context_url: draft.post.url,
    start_seconds: null,
    end_seconds: null,
  };
}

/** The draft dressed as a note row, so the website's note box can draw a note
 *  that is not on the site. */
function draftAsNote(draft: ReviewDraft): NoteRow {
  const id = draftNoteId(draft);
  return {
    id,
    claim_id: id,
    note: draft.note,
    sources: draft.sources.map((s, i) => ({ url: s.url, sort_order: i })),
    has_source_details: draft.sources.length > 0,
    helpful_count: 0,
    somewhat_helpful_count: 0,
    not_helpful_count: 0,
    author_id: null,
    author_name: null,
    improved_from_note_id: null,
    status: "draft",
    created_at: draft.createdAt,
    claim: draftClaim(draft),
  };
}

function CardHeader({ draft }: { draft: ReviewDraft }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-medium text-fg-secondary">{draft.post.creator}</p>
      <p className="text-xs text-fg-muted">
        {KIND_LABELS[draft.kind]} · {statusLine(draft)}
      </p>
    </div>
  );
}

type Step =
  | { step: "vote_waiting"; vote: Vote }
  | { step: "replace"; note: string; sources?: ReviewDraft["sources"]; postedAs?: "ai" | "me" }
  | { step: "delete" }
  | { step: "skip"; skip: boolean }
  | { step: "leaderboard" }
  | { step: "explain"; text: string }
  | { step: "message"; text: string };

/** Steps that take the draft out of the section it is shown in. */
const MOVES_THE_DRAFT = new Set<Step["step"]>(["delete", "skip"]);

/** Sends one reviewer step and updates the page. A step that moves the draft
 *  to another section takes it out of this one. Every other step reads the
 *  draft again, which keeps it in place even when its section changed, such
 *  as after a vote. Both refresh the sidebar's counts. */
function useReviewStep(draft: ReviewDraft, view: ReviewView, onDone?: () => void) {
  const client = useQueryClient();
  const { session } = useSession();
  const voteOnNote = useVoteOnNote();
  return useMutation({
    mutationFn: async (step: Step) => {
      if (step.step === "vote_waiting") {
        // An upvote posts the note, and the reviewer's vote then goes on it
        // through the website's ordinary vote, which records the donation and
        // the verdict.
        const noteId = await voteOnWaitingDraft(draft.id, step.vote);
        if (!noteId) return;
        const note = await fetchNote(noteId);
        if (!note) throw new Error("The posted note could not be read back");
        await voteOnNote(note, step.vote);
      } else if (step.step === "replace") {
        const noteId = await rewriteDraft(draft.id, { note: step.note, sources: step.sources, postedAs: step.postedAs, reason: "Replaced on the review page" });
        // A note posted under the admin's own account gets their automatic
        // Helpful vote from the database, and its donation is minted here,
        // as for any note written on the website.
        if (noteId && step.postedAs === "me") await mintSelfVoteDonation(noteId, session!.user);
      } else if (step.step === "delete") {
        await deleteDraftNote(draft.id);
      } else if (step.step === "skip") {
        await skipDraft(draft.id, step.skip);
      } else if (step.step === "leaderboard") {
        await addToLeaderboard(draft.noteId!);
      } else if (step.step === "explain") {
        await explainVote(draft.id, step.text);
      } else {
        await sendDraftMessage(draft.id, step.text);
      }
    },
    onSuccess: async (_result, step) => {
      onDone?.();
      // A note posted under the admin's account carries their automatic vote,
      // which the cached list of their own votes does not know yet.
      if (step.step === "replace" && step.postedAs === "me") await client.invalidateQueries({ queryKey: queryKeys.ownVotes });
      if (step.step === "leaderboard") await client.invalidateQueries({ queryKey: queryKeys.curation });
      if (MOVES_THE_DRAFT.has(step.step)) dropDraft(client, view, draft.id);
      else await refreshDrafts(client, view, [draft.id]);
      await client.invalidateQueries({ queryKey: queryKeys.noteReviewSummaries });
    },
  });
}

function ErrorText({ error }: { error: Error | null }) {
  return error ? <span className="text-sm text-negative">{error.message}</span> : null;
}

function EarlierVersions({ draft }: { draft: ReviewDraft }) {
  if (draft.earlierVersions.length === 0) return null;
  return (
    <details className="text-sm text-fg-secondary">
      <summary className="cursor-pointer text-fg-muted">Earlier versions ({draft.earlierVersions.length})</summary>
      {draft.earlierVersions.map((v) => (
        <div key={v.at} className="mt-2 space-y-1">
          <p className="whitespace-pre-wrap border-l-2 border-line pl-3">{v.note}</p>
          {v.reason && <p className="text-xs text-fg-muted">{v.reason}</p>}
        </div>
      ))}
    </details>
  );
}

/** The reasons reviewers gave for their votes, and for old rejections. */
function Explanations({ draft }: { draft: ReviewDraft }) {
  if (draft.explanations.length === 0) return null;
  return (
    <div className="space-y-1 text-sm text-fg-secondary">
      {draft.explanations.map((e) => (
        <p key={e.at}>
          <span className="font-medium">{PERSON[e.actor]}:</span> {e.text}
        </p>
      ))}
    </div>
  );
}

/** The note judge's prediction for the note's current text. Each of the two
 *  numbers shows only while its toggle in the sidebar is on. */
function JudgeLine({ draft, shown }: { draft: ReviewDraft; shown: JudgeShown }) {
  if (!draft.judge || (!shown.helpful && !shown.impactful)) return null;
  const parts = [shown.helpful && `P(helpful) ${draft.judge.pHelpful.toFixed(2)}`, shown.impactful && `P(impactful) ${draft.judge.pImpactful.toFixed(2)}`].filter(Boolean);
  return (
    <details className="text-sm text-fg-secondary">
      <summary className="cursor-pointer">Judge: {parts.join(", ")}</summary>
      <p className="mt-1 whitespace-pre-wrap">{draft.judge.reasoning}</p>
    </details>
  );
}

/** The optional box under a note after the reviewer voted on it. */
function ExplainBox({ draft, view, onClose }: { draft: ReviewDraft; view: ReviewView; onClose: () => void }) {
  const [text, setText] = useState("");
  const explain = useReviewStep(draft, view, onClose);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) explain.mutate({ step: "explain", text: text.trim() });
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea className="w-full" rows={2} autoFocus placeholder="Optional: Explain your decision" value={text} onChange={(e) => setText(e.currentTarget.value)} />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={explain.isPending || !text.trim()}>
          Submit
        </Button>
        <Button type="button" variant="quiet" onClick={onClose}>
          Close
        </Button>
        <ErrorText error={explain.error} />
      </div>
    </form>
  );
}

/** A chat with Claude about one draft. A reviewer asks a question or suggests
 *  a change, and Claude answers here. When the reviewer asked for a change,
 *  Claude's improved version appears in the box below the chat. */
function Chat({ draft, view }: { draft: ReviewDraft; view: ReviewView }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const send = useReviewStep(draft, view, () => setText(""));
  if (!open && draft.messages.length === 0) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Chat with Claude
      </Button>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) send.mutate({ step: "message", text: text.trim() });
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-control border border-line p-3 text-sm">
      {draft.messages.map((m) => (
        <p key={m.at} className={m.actor === "claude" ? "text-fg-secondary" : undefined}>
          <span className="font-medium">{PERSON[m.actor]}:</span> {m.text}
        </p>
      ))}
      {waitsForClaude(draft) && <p className="text-fg-muted">Claude is working on it. The answer shows up here.</p>}
      <Textarea className="w-full" rows={2} placeholder="Ask a question or suggest a change. Claude answers here." value={text} onChange={(e) => setText(e.currentTarget.value)} />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={send.isPending || !text.trim()}>
          Send
        </Button>
        <ErrorText error={send.error} />
      </div>
    </form>
  );
}

/** One box for a better text of the note. Claude fills it with its proposal
 *  from the chat, or the reviewer writes one, starting from the note as it
 *  is. Posting it replaces the live note; for a note that waits for approval
 *  it replaces the waiting text. */
function ImprovedVersion({ draft, view }: { draft: ReviewDraft; view: ReviewView }) {
  const { session } = useSession();
  const proposal = draft.proposal;
  const [open, setOpen] = useState(proposal !== null);
  const [shownProposal, setShownProposal] = useState(proposal?.note);
  const [note, setNote] = useState(proposal?.note ?? draft.note);
  const [postedAs, setPostedAs] = useState<"ai" | "me">("ai");
  const save = useReviewStep(draft, view, () => setOpen(false));
  // A proposal that arrives while the card is open fills the box.
  if (proposal && proposal.note !== shownProposal) {
    setShownProposal(proposal.note);
    setNote(proposal.note);
    setOpen(true);
  }
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Improve the note
      </Button>
    );
  }
  const posted = draft.status === "posted";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ step: "replace", note, sources: proposal?.sources, postedAs: posted ? postedAs : undefined });
  };
  return (
    <form onSubmit={submit} className="space-y-2 rounded-control border border-line p-3">
      <p className="text-sm font-medium text-fg">Improved version</p>
      {proposal && <p className="text-xs text-fg-muted">Claude proposed this from the chat. Edit it before you post it if you like.</p>}
      <Textarea className="w-full" rows={4} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {posted && (
          <>
            <label htmlFor={`posted-as-${draft.id}`}>Post as</label>
            <select
              id={`posted-as-${draft.id}`}
              className="rounded-control border border-line-input bg-surface px-2 py-1.5 text-sm text-fg"
              value={postedAs}
              onChange={(e) => setPostedAs(e.currentTarget.value as "ai" | "me")}
            >
              <option value="ai">An AI note</option>
              <option value="me">{session ? displayName(session) : "Me"}</option>
            </select>
          </>
        )}
        <Button type="submit" disabled={save.isPending || !note.trim() || (note === draft.note && !proposal)}>
          {posted ? "Replace the live note" : "Save"}
        </Button>
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <ErrorText error={save.error} />
      </div>
    </form>
  );
}

/** Skip, Add to leaderboard and Delete from the site. */
function Actions({ draft, view }: { draft: ReviewDraft; view: ReviewView }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const act = useReviewStep(draft, view, () => setConfirmingDelete(false));
  const posted = draft.status === "posted";
  if (confirmingDelete) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Delete this note from the site? Its votes go with it.</span>
        <Button disabled={act.isPending} onClick={() => act.mutate({ step: "delete" })}>
          Delete
        </Button>
        <Button variant="quiet" onClick={() => setConfirmingDelete(false)}>
          Cancel
        </Button>
        <ErrorText error={act.error} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(reviewOpen(draft) || draft.skipped) && (
        <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ step: "skip", skip: !draft.skipped })}>
          {draft.skipped ? "Unskip" : "Skip"}
        </Button>
      )}
      {posted &&
        (draft.onLeaderboard ? (
          <span className="text-sm text-fg-muted">On the leaderboard</span>
        ) : (
          <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ step: "leaderboard" })}>
            Add to leaderboard
          </Button>
        ))}
      {posted && (
        <Button variant="quiet" disabled={act.isPending} onClick={() => setConfirmingDelete(true)}>
          Delete from the site
        </Button>
      )}
      <ErrorText error={act.error} />
    </div>
  );
}

/** A note that is not on the site shows as plain text. */
function RemovedNote({ draft }: { draft: ReviewDraft }) {
  return <p className="whitespace-pre-wrap border-l-2 border-line pl-3 text-sm text-fg-secondary">{draft.note}</p>;
}

/** A note that waits for approval, with the rating pills. An upvote posts it
 *  and casts the vote, and Not helpful keeps it off the site. */
function WaitingNote({ draft, view, onVoted }: { draft: ReviewDraft; view: ReviewView; onVoted: () => void }) {
  const vote = useReviewStep(draft, view, onVoted);
  return (
    <div className="space-y-2">
      <NoteBox note={draftAsNote(draft)} status="needs_ratings" sourcesOpen>
        <VoteRatings helpful={0} somewhatHelpful={0} notHelpful={0} onVote={(v) => vote.mutate({ step: "vote_waiting", vote: v })} />
      </NoteBox>
      <ErrorText error={vote.error} />
    </div>
  );
}

/** One passage the Claude note writer's agents looked at, on the website's
 *  own card: the passage in its post, then the note with its live votes while
 *  it is on the site. Jim's or Nathan's vote on the note is the review, and
 *  after a vote an optional box asks why. Then come the judge's prediction,
 *  the agent's reasoning, the chat with Claude, the improved version and the
 *  reviewer's buttons. A card shown outside a review section, such as on the
 *  note judge experiment page, has none of the review's parts, and shows
 *  `extra` under the reasoning instead. */
export function ReviewCard({ draft, liveNote, view, judgeShown, extra }: {
  draft: ReviewDraft;
  liveNote: NoteRow | undefined;
  view?: ReviewView;
  judgeShown?: JudgeShown;
  extra?: ReactNode;
}) {
  const client = useQueryClient();
  const [explaining, setExplaining] = useState(false);
  const post: FeedItemRow = { id: draft.itemId, project_id: null, url: draft.post.url, title: draft.post.title, published_at: null, created_at: draft.createdAt };
  const shareUrl = liveNote && draft.post.creatorSlug ? noteUrl(draft.post.creatorSlug, liveNote.id) : draft.post.url;
  // The vote's trigger changed the verdict, so the card and the counts are
  // read again, and the box for an explanation opens.
  const onVoted = (vote: Vote | undefined) => {
    if (!view) return;
    setExplaining(vote !== undefined);
    void refreshDrafts(client, view, [draft.id]);
    void client.invalidateQueries({ queryKey: queryKeys.noteReviewSummaries });
  };
  const reviewable = view && (draft.status === "posted" || draft.status === "awaiting_approval");
  return (
    <ClaimCard
      claim={liveNote?.claim ?? draftClaim(draft)}
      paragraph={liveNote?.claim.context_paragraph ?? draft.contextParagraph}
      post={post}
      byline={<CardHeader draft={draft} />}
    >
      <div className="space-y-4">
        {!isNote(draft) ? (
          <p className="text-sm text-fg-secondary">{draft.reasoning}</p>
        ) : liveNote ? (
          <Note note={liveNote} shareUrl={shareUrl} onVoted={onVoted} />
        ) : draft.status === "awaiting_approval" && view ? (
          <WaitingNote draft={draft} view={view} onVoted={() => onVoted(0)} />
        ) : draft.status === "posted" || draft.status === "awaiting_approval" ? (
          <NoteBox note={draftAsNote(draft)} status="needs_ratings" sourcesOpen />
        ) : (
          <RemovedNote draft={draft} />
        )}
        {view && explaining && <ExplainBox draft={draft} view={view} onClose={() => setExplaining(false)} />}
        <Explanations draft={draft} />
        {judgeShown && <JudgeLine draft={draft} shown={judgeShown} />}
        {isNote(draft) && (
          <details className="text-sm text-fg-secondary">
            <summary className="cursor-pointer text-fg-muted">The agent's reasoning</summary>
            <p className="mt-1">{draft.reasoning}</p>
          </details>
        )}
        <EarlierVersions draft={draft} />
        {extra}
        {view && (
          <>
            <Chat draft={draft} view={view} />
            {reviewable && <ImprovedVersion draft={draft} view={view} />}
            <Actions draft={draft} view={view} />
          </>
        )}
      </div>
    </ClaimCard>
  );
}
