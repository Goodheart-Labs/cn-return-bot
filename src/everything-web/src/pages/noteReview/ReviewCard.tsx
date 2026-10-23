import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { approveDraft, rejectDraft, rewriteDraft, sendDraftMessage, type Reviewer, type ReviewDraft, type ReviewSection } from "@cn/core/claudeReview";
import { mintSelfVoteDonation } from "@cn/core/donations";
import { fetchNote } from "@cn/core/notes";
import { displayName } from "@cn/core/session";
import type { ClaimRef, FeedItemRow, NoteRow } from "@cn/core/types";
import { useSession } from "@cn/features/auth/useSession";
import { Note } from "@cn/features/notes/Note";
import { NoteBox } from "@cn/features/notes/NoteBox";
import { useMyVotes, useVoteOnNote } from "@cn/features/notes/useVotes";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { Textarea } from "@cn/ui/Field";
import { ClaimCard } from "../../components/ClaimCard";
import { noteUrl } from "../../lib/routing";
import { draftNoteId, dropDraft, refreshDrafts, waitsForClaude } from "./reviewQueries";

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
/** A vote of Helpful, which approving a note casts for the reviewer. */
const HELPFUL = 1;

const isNote = (draft: ReviewDraft) => draft.status !== "not_a_note";

function statusLine(draft: ReviewDraft): string {
  if (draft.status === "awaiting_approval") return "Waiting for approval";
  if (draft.status === "rejected") return `Rejected by ${PERSON[draft.reviewedBy ?? "jim"]}`;
  if (draft.status !== "posted") return NO_NOTE_LABELS[draft.outcome as Exclude<ReviewDraft["outcome"], "note">];
  const posted = !draft.postedAs || draft.postedAs === "ai" ? "Posted as an AI note" : `Posted by ${PERSON[draft.postedAs]}`;
  return draft.reviewedBy ? `${posted}, approved by ${PERSON[draft.reviewedBy]}` : `${posted}, not reviewed yet`;
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
  | { step: "approve" }
  | { step: "reject"; reason: string }
  | { step: "rewrite"; note: string; postedAs?: "ai" | "me" }
  | { step: "message"; text: string };

/** Sends one reviewer step and updates the page. A step that moves the draft
 *  to another section takes it out of this one, refreshes the counts, and
 *  drops the cached other sections, so they load fresh when opened. A step
 *  that keeps it here reads the draft again. */
function useReviewStep(draft: ReviewDraft, section: ReviewSection, onDone?: () => void) {
  const client = useQueryClient();
  const { session } = useSession();
  const myVotes = useMyVotes();
  const voteOnNote = useVoteOnNote();
  return useMutation({
    mutationFn: async (step: Step) => {
      if (step.step === "approve") {
        const noteId = await approveDraft(draft.id);
        if (myVotes.get(noteId) === HELPFUL) return;
        const note = await fetchNote(noteId);
        if (!note) throw new Error("The approved note could not be read back");
        await voteOnNote(note, HELPFUL);
      } else if (step.step === "reject") {
        await rejectDraft(draft.id, step.reason);
      } else if (step.step === "rewrite") {
        const noteId = await rewriteDraft(draft.id, { note: step.note, postedAs: step.postedAs, reason: "Rewritten on the review page" });
        // A note posted under the admin's own account gets their automatic
        // Helpful vote from the database, and its donation is minted here,
        // as for any note written on the website.
        if (noteId && step.postedAs === "me") await mintSelfVoteDonation(noteId, session!.user);
      } else {
        await sendDraftMessage(draft.id, step.text);
      }
    },
    onSuccess: async (_result, step) => {
      onDone?.();
      // A note posted under the admin's account carries their automatic vote,
      // which the cached list of their own votes does not know yet.
      if (step.step === "rewrite" && step.postedAs === "me") await client.invalidateQueries({ queryKey: queryKeys.ownVotes });
      if (step.step === "approve" || step.step === "reject") {
        dropDraft(client, section, draft.id);
        client.removeQueries({ queryKey: ["noteReview", "section"], predicate: (q) => q.queryKey[2] !== section });
      } else {
        await refreshDrafts(client, section, [draft.id]);
      }
      await client.invalidateQueries({ queryKey: queryKeys.noteReviewSummary });
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

/** A chat with Claude about one draft. A reviewer asks a question or suggests
 *  a change, and Claude answers here, changing the note if that was asked. */
function Chat({ draft, section }: { draft: ReviewDraft; section: ReviewSection }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const send = useReviewStep(draft, section, () => setText(""));
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

function RewriteForm({ draft, section, onDone }: { draft: ReviewDraft; section: ReviewSection; onDone: () => void }) {
  const { session } = useSession();
  const [note, setNote] = useState(draft.note);
  const [postedAs, setPostedAs] = useState<"ai" | "me">("ai");
  const save = useReviewStep(draft, section, onDone);
  const posted = draft.status === "posted";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ step: "rewrite", note, postedAs: posted ? postedAs : undefined });
  };
  return (
    <form onSubmit={submit} className="space-y-2">
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
              <option value="me">{session ? displayName(session) : "Me"}</option>
              <option value="ai">An AI note</option>
            </select>
          </>
        )}
        <Button type="submit" disabled={save.isPending || !note.trim() || note === draft.note}>
          {posted ? "Replace the posted note" : "Save"}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <ErrorText error={save.error} />
      </div>
    </form>
  );
}

function Actions({ draft, section }: { draft: ReviewDraft; section: ReviewSection }) {
  const [mode, setMode] = useState<"rewrite" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const act = useReviewStep(draft, section, () => setMode(null));
  if (draft.status !== "posted" && draft.status !== "awaiting_approval") return null;
  if (mode === "rewrite") return <RewriteForm draft={draft} section={section} onDone={() => setMode(null)} />;
  if (mode === "reject") {
    return (
      <div className="space-y-2">
        <Textarea className="w-full" rows={2} autoFocus placeholder="Why is this note not good? Claude learns from this." value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={act.isPending} onClick={() => act.mutate({ step: "reject", reason })}>
            {draft.status === "posted" ? "Reject and delete the note" : "Reject"}
          </Button>
          <Button variant="quiet" onClick={() => setMode(null)}>
            Cancel
          </Button>
          <ErrorText error={act.error} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!draft.reviewedBy && (
        <Button disabled={act.isPending} onClick={() => act.mutate({ step: "approve" })}>
          {draft.status === "awaiting_approval" ? "Approve and post" : "Approve"}
        </Button>
      )}
      <Button variant="secondary" disabled={act.isPending} onClick={() => setMode("rewrite")}>
        Rewrite
      </Button>
      <Button variant="secondary" disabled={act.isPending} onClick={() => setMode("reject")}>
        Reject
      </Button>
      <ErrorText error={act.error} />
    </div>
  );
}

/** A rejected note is deleted from the site, so it shows as plain text with
 *  the reviewer's reason. */
function RejectedNote({ draft }: { draft: ReviewDraft }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="whitespace-pre-wrap border-l-2 border-line pl-3 text-fg-secondary">{draft.note}</p>
      <p className="text-xs text-fg-muted">{draft.rejectionReason ? `Reason: ${draft.rejectionReason}` : "No reason given."}</p>
    </div>
  );
}

/** One passage the Claude note writer's agents looked at, on the website's
 *  own card: the passage in its post, then the note with its live votes while
 *  it is on the site, then the agent's reasoning, the chat with Claude and the
 *  reviewer's buttons. */
export function ReviewCard({ draft, liveNote, section }: { draft: ReviewDraft; liveNote: NoteRow | undefined; section: ReviewSection }) {
  const post: FeedItemRow = { id: draft.itemId, project_id: null, url: draft.post.url, title: draft.post.title, published_at: null, created_at: draft.createdAt };
  const shareUrl = liveNote && draft.post.creatorSlug ? noteUrl(draft.post.creatorSlug, liveNote.id) : draft.post.url;
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
        ) : draft.status === "rejected" ? (
          <RejectedNote draft={draft} />
        ) : liveNote ? (
          <Note note={liveNote} shareUrl={shareUrl} />
        ) : (
          <NoteBox note={draftAsNote(draft)} status="needs_ratings" sourcesOpen />
        )}
        {isNote(draft) && (
          <details className="text-sm text-fg-secondary">
            <summary className="cursor-pointer text-fg-muted">The agent's reasoning</summary>
            <p className="mt-1">{draft.reasoning}</p>
          </details>
        )}
        <EarlierVersions draft={draft} />
        <Chat draft={draft} section={section} />
        <Actions draft={draft} section={section} />
      </div>
    </ClaimCard>
  );
}
