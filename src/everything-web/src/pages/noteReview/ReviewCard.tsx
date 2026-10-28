import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addToLeaderboard } from "@cn/core/bestNotes";
import {
  deleteDraftNote,
  rewriteDraft,
  sendDraftMessage,
  setFewShotExample,
  setReviewNote,
  skipDraft,
  type Reviewer,
  type ReviewDraft,
  type ReviewVote,
} from "@cn/core/claudeReview";
import { setCreatorXHandle } from "@cn/core/creatorX";
import { mintSelfVoteDonation } from "@cn/core/donations";
import { bucketChips } from "@cn/core/fieldQuery";
import { displayName } from "@cn/core/session";
import type { ClaimRef, FeedItemRow, NoteRow } from "@cn/core/types";
import type { Vote } from "@cn/core/votes";
import { setXMark, type XMark } from "@cn/core/xMarks";
import { useSession } from "@cn/features/auth/useSession";
import { Note } from "@cn/features/notes/Note";
import { NoteBox } from "@cn/features/notes/NoteBox";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { DropdownMenu } from "@cn/ui/DropdownMenu";
import { Textarea } from "@cn/ui/Field";
import { CheckIcon, TrashIcon } from "@cn/ui/icons";
import { ClaimCard } from "../../components/ClaimCard";
import { noteUrl } from "../../lib/routing";
import { PostOnX } from "./PostOnX";
import { DISPLAY, REVIEW_FIELDS, type DisplayOption } from "./reviewFields";
import { draftNoteId, refreshCreator, refreshDrafts, waitsForClaude, type ReviewView } from "./reviewQueries";
import { TWEET_SERVER } from "./tweetServer";

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
const REVIEWERS: Reviewer[] = ["jim", "nathan"];
const VOTE_LABELS: Record<ReviewVote, string> = { 1: "Helpful", 0: "Somewhat helpful", [-1]: "Not helpful" };
const VOTE_TONES: Record<ReviewVote, string> = {
  1: "bg-positive-soft text-positive",
  0: "bg-caution-soft text-caution",
  [-1]: "bg-negative-soft text-negative",
};

const isNote = (draft: ReviewDraft) => draft.status !== "not_a_note";
const reviewOpen = (draft: ReviewDraft) => draft.verdict === null && (draft.status === "posted" || draft.status === "posting");

/** The review's state, the loudest label on the card. */
function verdictChip(draft: ReviewDraft): { text: string; tone: string } | null {
  if (!isNote(draft)) return null;
  const by = PERSON[draft.reviewedBy ?? "jim"];
  if (draft.verdict === "approved") return { text: `Approved by ${by}`, tone: "bg-positive-soft text-positive" };
  if (draft.verdict === "disapproved") return { text: `Disapproved by ${by}`, tone: "bg-negative-soft text-negative" };
  if (draft.status === "posting") return { text: "Not posted", tone: "bg-caution-soft text-caution" };
  return { text: "Not reviewed", tone: "bg-surface-muted text-fg-secondary" };
}

function detailsLine(draft: ReviewDraft): string {
  const views = draft.views === 1 ? "1 view" : `${draft.views} views`;
  if (!isNote(draft)) return `${NO_NOTE_LABELS[draft.outcome as Exclude<ReviewDraft["outcome"], "note">]} · ${views}`;
  const where =
    draft.status === "removed" ? "Not on the site" : draft.status === "posting" ? "Saved, not on the site yet" : !draft.postedAs || draft.postedAs === "ai" ? "Posted as an AI note" : `Posted by ${PERSON[draft.postedAs]}`;
  return `${KIND_LABELS[draft.kind]} · ${where} · ${views}`;
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

/** The buckets the card sits in, one per sort level when there are several,
 *  so the order of the list can be read off the cards. */
function BucketChips({ draft, view }: { draft: ReviewDraft; view: ReviewView }) {
  const chips = bucketChips(REVIEW_FIELDS, view.sorts, draft.fields, view.now);
  if (chips.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span key={chip} className="rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-secondary">
          {chip}
        </span>
      ))}
    </p>
  );
}

/** The creator's X account beside their name, which an admin can correct. An
 *  empty handle records that the creator has no X account. */
function CreatorXAccount({ draft, view }: { draft: ReviewDraft; view: ReviewView }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState((draft.fields.creator_x_handle as string | null) ?? "");
  const slug = draft.post.creatorSlug!;
  const save = useMutation({
    mutationFn: () => setCreatorXHandle(slug, handle.trim() || null, "Set by hand on the review page"),
    onSuccess: async () => {
      setEditing(false);
      await refreshCreator(client, view.request, slug);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  if (editing) {
    return (
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 text-xs">
        <input
          autoFocus
          value={handle}
          onChange={(e) => setHandle(e.currentTarget.value)}
          placeholder="X handle, empty for none"
          aria-label="The creator's X handle. Leave it empty if they have none."
          className="w-44 rounded-control border border-line-input bg-surface px-2 py-1 text-fg"
        />
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
        <Button type="button" variant="quiet" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <ErrorText error={save.error} />
      </form>
    );
  }
  const status = draft.fields.creator_x;
  const evidence = (draft.fields.creator_x_evidence as string | null) ?? undefined;
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
      {status === "found" ? (
        <a href={`https://x.com/${draft.fields.creator_x_handle}`} target="_blank" rel="noreferrer" title={evidence} className="text-link hover:underline">
          @{String(draft.fields.creator_x_handle)}
        </a>
      ) : (
        <span title={evidence}>{status === "none" ? "No X account" : "X account not looked up yet"}</span>
      )}
      <Button variant="link" onClick={() => setEditing(true)}>
        Edit
      </Button>
    </span>
  );
}

function CardHeader({ draft, view }: { draft: ReviewDraft; view?: ReviewView }) {
  const chip = verdictChip(draft);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm font-medium text-fg-secondary">
          <span className="truncate">{draft.post.creator}</span>
          {view && draft.post.creatorSlug && <CreatorXAccount draft={draft} view={view} />}
        </p>
        {chip && <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", chip.tone)}>{chip.text}</span>}
      </div>
      <p className="text-xs text-fg-muted" title="The views count readers outside our team who were shown the notes on this post">
        {detailsLine(draft)}
      </p>
      {view && <BucketChips draft={draft} view={view} />}
    </div>
  );
}

type Step =
  | { step: "replace"; note: string; sources?: ReviewDraft["sources"]; postedAs?: "ai" | "me" }
  | { step: "delete" }
  | { step: "skip"; skip: boolean }
  | { step: "leaderboard" }
  | { step: "xMark"; mark: XMark | null }
  | { step: "fewShot"; on: boolean }
  | { step: "reviewNote"; text: string }
  | { step: "message"; text: string };

/** Sends one reviewer step and reads the draft again. The card stays where it
 *  is, even when the draft no longer matches the filters. */
function useReviewStep(draft: ReviewDraft, view: ReviewView, onDone?: () => void) {
  const client = useQueryClient();
  const { session } = useSession();
  return useMutation({
    mutationFn: async (step: Step) => {
      if (step.step === "replace") {
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
      } else if (step.step === "xMark") {
        await setXMark(draft.noteId!, step.mark);
      } else if (step.step === "fewShot") {
        await setFewShotExample(draft.id, step.on);
      } else if (step.step === "reviewNote") {
        await setReviewNote(draft.id, step.text);
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
      await refreshDrafts(client, view.request, [draft.id]);
    },
  });
}

function ErrorText({ error }: { error: Error | null }) {
  return error ? (
    <span role="alert" className="text-sm text-negative">
      {error.message}
    </span>
  ) : null;
}

/** A small heading over each part of the side column. */
function AsideHeading({ children }: { children: ReactNode }) {
  return <h3 className="font-semibold text-fg-secondary">{children}</h3>;
}

/** Jim's and Nathan's votes on the note. */
function Votes({ draft }: { draft: ReviewDraft }) {
  if (draft.reviewerVotes.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {REVIEWERS.flatMap((reviewer) => {
        const vote = draft.reviewerVotes.find((v) => v.reviewer === reviewer)?.vote;
        return vote === undefined
          ? []
          : [
              <span key={reviewer} className="flex items-center gap-1.5">
                <span className="font-medium text-fg-secondary">{PERSON[reviewer]}</span>
                <span className={cn("rounded-full px-2 py-0.5 font-semibold", VOTE_TONES[vote])}>{VOTE_LABELS[vote]}</span>
              </span>,
            ];
      })}
    </p>
  );
}

/** The box that edits the shared review note, both after a vote and from the
 *  side column. It starts from the note as it is. */
function ReviewNoteForm({ draft, view, placeholder, onClose }: { draft: ReviewDraft; view: ReviewView; placeholder: string; onClose: () => void }) {
  const [text, setText] = useState(draft.reviewNote?.text ?? "");
  const save = useReviewStep(draft, view, onClose);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ step: "reviewNote", text });
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea className="w-full text-sm" rows={3} autoFocus placeholder={placeholder} value={text} onChange={(e) => setText(e.currentTarget.value)} />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={save.isPending || text.trim() === (draft.reviewNote?.text ?? "")}>
          Save
        </Button>
        <Button type="button" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <ErrorText error={save.error} />
      </div>
    </form>
  );
}

/** The votes, and Jim's and Nathan's one shared note on the card, which
 *  either of them edits in place. */
function Reviews({ draft, view }: { draft: ReviewDraft; view?: ReviewView }) {
  const [editing, setEditing] = useState(false);
  const note = draft.reviewNote;
  if (!note && draft.reviewerVotes.length === 0 && !view) return null;
  return (
    <section className="space-y-2">
      <AsideHeading>Our review</AsideHeading>
      <Votes draft={draft} />
      {editing && view ? (
        <ReviewNoteForm draft={draft} view={view} placeholder="Why is this note good or bad?" onClose={() => setEditing(false)} />
      ) : note ? (
        <div className="space-y-0.5">
          <p className="whitespace-pre-wrap text-fg-secondary">{note.text}</p>
          {view && (
            <Button variant="link" className="text-2xs" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      ) : (
        view && (
          <Button variant="link" className="text-2xs" onClick={() => setEditing(true)}>
            Add a note
          </Button>
        )
      )}
    </section>
  );
}

const meterTone = (p: number, good: number, bad: number) => (p >= good ? "bg-positive-solid" : p <= bad ? "bg-negative-solid" : "bg-caution-solid");

function Meter({ label, value, tone }: { label: string; value: number; tone: string }) {
  const percent = Math.round(value * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span>{label}</span>
        <span className="font-semibold tabular-nums text-fg-secondary">{percent}%</span>
      </div>
      <div className="h-1 rounded-full bg-surface-muted" role="meter" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** The note judge's guesses for the note's current text, as two meters. */
function Judge({ draft }: { draft: ReviewDraft }) {
  if (!draft.judge) return null;
  const { pHelpful, pImpactful, reasoning } = draft.judge;
  return (
    <section className="space-y-3">
      <AsideHeading>The judge's guess</AsideHeading>
      <Meter label="Chance of a helpful rating" value={pHelpful} tone={meterTone(pHelpful, 0.7, 0.4)} />
      <Meter label="Chance of the leaderboard" value={pImpactful} tone={meterTone(pImpactful, 0.3, 0.15)} />
      <details>
        <summary className="cursor-pointer">Why</summary>
        <p className="mt-1 whitespace-pre-wrap">{reasoning}</p>
      </details>
    </section>
  );
}

function EarlierVersions({ draft }: { draft: ReviewDraft }) {
  if (draft.earlierVersions.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer">Earlier versions ({draft.earlierVersions.length})</summary>
      {draft.earlierVersions.map((v) => (
        <div key={v.at} className="mt-2 space-y-1 rounded-control bg-surface-muted px-3 py-2">
          <p className="whitespace-pre-wrap">{v.note}</p>
          {v.reason && <p>{v.reason}</p>}
        </div>
      ))}
    </details>
  );
}

/** The note-writing agent's reasoning, closed until the reviewer opens it. */
function AgentReasoning({ reasoning }: { reasoning: string }) {
  return (
    <details>
      <summary className="cursor-pointer font-semibold text-fg-secondary">The agent's reasoning</summary>
      <p className="mt-1">{reasoning}</p>
    </details>
  );
}

/** What sits beside the card on a wide screen and under it on a narrow one:
 *  the reviews, the judge's guess, the agent's reasoning and the note's
 *  earlier texts. */
function SideColumn({ draft, view, extra }: { draft: ReviewDraft; view?: ReviewView; extra?: ReactNode }) {
  return (
    // The side column is set like the surrounding context on the card's other
    // side: small and muted, so the eye stays on the card.
    <div className="space-y-4 text-2xs text-fg-muted [overflow-wrap:anywhere]">
      {isNote(draft) && <Reviews draft={draft} view={view} />}
      {view && <Judge draft={draft} />}
      {isNote(draft) && <AgentReasoning reasoning={draft.reasoning} />}
      <EarlierVersions draft={draft} />
      {extra}
    </div>
  );
}

/** A chat with Claude about one draft. A reviewer asks a question or suggests
 *  a change, and Claude answers here. When the reviewer asked for a change,
 *  Claude's improved version fills the box for it. */
function Chat({ draft, view }: { draft: ReviewDraft; view: ReviewView }) {
  const [text, setText] = useState("");
  const send = useReviewStep(draft, view, () => setText(""));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) send.mutate({ step: "message", text: text.trim() });
  };
  return (
    <form onSubmit={submit} className="space-y-3 border-t border-line pt-4 text-sm">
      <div>
        <h3 className="font-medium text-fg">Chat with Claude</h3>
        <p className="text-xs text-fg-muted">Claude answers here within a few minutes. When you ask for a change, its new text appears under Improved version.</p>
      </div>
      {draft.messages.map((m) => (
        <p key={m.at} className={m.actor === "claude" ? "text-fg-secondary" : undefined}>
          <span className="font-medium">{PERSON[m.actor]}:</span> {m.text}
        </p>
      ))}
      {waitsForClaude(draft) && <p className="text-fg-muted">Claude is working on it.</p>}
      <Textarea className="w-full" rows={2} placeholder="Ask a question or suggest a change" value={text} onChange={(e) => setText(e.currentTarget.value)} />
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
 *  is. Posting it replaces the live note. */
function ImprovedVersion({ draft, view, onClose }: { draft: ReviewDraft; view: ReviewView; onClose: () => void }) {
  const { session } = useSession();
  const proposal = draft.proposal;
  const [shownProposal, setShownProposal] = useState(proposal?.note);
  const [note, setNote] = useState(proposal?.note ?? draft.note);
  const [postedAs, setPostedAs] = useState<"ai" | "me">("ai");
  const save = useReviewStep(draft, view, onClose);
  // A proposal that arrives while the box is open fills it.
  if (proposal && proposal.note !== shownProposal) {
    setShownProposal(proposal.note);
    setNote(proposal.note);
  }
  // A note can quote one page several times, so each page is listed once.
  const sourcePages = [...new Set((proposal?.sources ?? draft.sources).map((s) => s.url))];
  const unchanged = note === draft.note && !proposal;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ step: "replace", note, sources: proposal?.sources, postedAs });
  };
  return (
    <form onSubmit={submit} className="space-y-3 border-t border-line pt-4 text-sm">
      <div>
        <h3 className="font-medium text-fg">Improved version</h3>
        <p className="text-xs text-fg-muted">
          {proposal ? "Claude proposed this from the chat. Edit it before you post it if you like." : "Edit the note's text, then replace the live note with it."}
        </p>
      </div>
      <Textarea className="w-full" rows={4} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      {sourcePages.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-fg-muted">{proposal ? "Sources of the proposal" : "The sources stay as they are"}</p>
          <ul className="space-y-0.5 text-xs">
            {sourcePages.map((url) => (
              <li key={url} className="truncate">
                <a href={url} target="_blank" rel="noreferrer" className="text-link hover:underline">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
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
        <Button type="submit" disabled={save.isPending || !note.trim() || unchanged} title={unchanged ? "Edit the text first" : undefined}>
          Replace the live note
        </Button>
        <Button type="button" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <ErrorText error={save.error} />
      </div>
    </form>
  );
}

/** Delete from the site, which asks once more in a small menu, because a
 *  deleted note takes its votes with it. */
function DeleteButton({ draft, view }: { draft: ReviewDraft; view: ReviewView }) {
  const remove = useReviewStep(draft, view);
  return (
    <DropdownMenu
      label="Delete from the site"
      entries={[
        { type: "heading", key: "question", label: "Delete this note from the site? Its votes go with it." },
        { type: "action", key: "delete", label: "Delete", icon: <TrashIcon size={16} />, danger: true, onSelect: () => remove.mutate({ step: "delete" }) },
      ]}
      trigger={
        <Button variant="secondary" disabled={remove.isPending}>
          Delete from the site
        </Button>
      }
    />
  );
}

/** A button that switches a mark on or off. It shows a tick while the mark
 *  is on. */
function MarkButton({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled: boolean }) {
  return (
    <Button variant="secondary" aria-pressed={on} disabled={disabled} onClick={onClick} title={on ? `${label}. Click to take the mark off` : undefined} className={cn(on && "border-link text-link")}>
      {on && <CheckIcon size={14} aria-hidden />}
      {label}
    </Button>
  );
}

type Panel = "chat" | "improve" | "post";

/** The card's tools in one row. The Display menu picks which of them show.
 *  The chat, the improved version and the tweet open below the row. */
function Tools({ draft, view }: { draft: ReviewDraft; view: ReviewView }) {
  const [open, setOpen] = useState<Panel | null>(draft.proposal ? "improve" : draft.messages.length > 0 ? "chat" : null);
  const [seenProposal, setSeenProposal] = useState(draft.proposal?.note);
  const act = useReviewStep(draft, view);
  const shows = (option: DisplayOption) => view.display.includes(option);
  const toggle = (panel: Panel) => setOpen(open === panel ? null : panel);
  const live = draft.status === "posted";
  // A proposal that arrives while the card is shown opens its box.
  if (draft.proposal && draft.proposal.note !== seenProposal) {
    setSeenProposal(draft.proposal.note);
    setOpen("improve");
  }
  const panelButton = (panel: Panel, label: string) => (
    <Button variant={open === panel ? "primary" : "secondary"} aria-expanded={open === panel} onClick={() => toggle(panel)}>
      {label}
    </Button>
  );
  const markX = (mark: XMark) => act.mutate({ step: "xMark", mark: draft.xMark === mark ? null : mark });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {live && TWEET_SERVER && shows(DISPLAY.postOnX.value) && draft.xMark !== "posted" && panelButton("post", "Post on X")}
        {live && shows(DISPLAY.markPosted.value) && <MarkButton on={draft.xMark === "posted"} label="Posted on X" disabled={act.isPending} onClick={() => markX("posted")} />}
        {live && shows(DISPLAY.wontPost.value) && <MarkButton on={draft.xMark === "wont_post"} label="We won't post this" disabled={act.isPending} onClick={() => markX("wont_post")} />}
        {shows(DISPLAY.chat.value) && panelButton("chat", "Chat with Claude")}
        {live && shows(DISPLAY.improve.value) && panelButton("improve", draft.proposal ? "Improved version" : "Improve the note")}
        {shows(DISPLAY.skip.value) && (reviewOpen(draft) || draft.skipped) && (
          <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ step: "skip", skip: !draft.skipped })}>
            {draft.skipped ? "Unskip" : "Skip"}
          </Button>
        )}
        {shows(DISPLAY.fewShot.value) && <MarkButton on={draft.fewShot} label="Few-shot example" disabled={act.isPending} onClick={() => act.mutate({ step: "fewShot", on: !draft.fewShot })} />}
        {live && shows(DISPLAY.leaderboard.value) &&
          (draft.onLeaderboard ? (
            <span className="text-sm text-fg-muted">On the leaderboard</span>
          ) : (
            <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ step: "leaderboard" })}>
              Add to leaderboard
            </Button>
          ))}
        {(live || draft.status === "posting") && shows(DISPLAY.delete.value) && <DeleteButton draft={draft} view={view} />}
        <ErrorText error={act.error} />
      </div>
      {open === "chat" && <Chat draft={draft} view={view} />}
      {open === "improve" && live && <ImprovedVersion draft={draft} view={view} onClose={() => setOpen(null)} />}
      {open === "post" && live && <PostOnX draft={draft} view={view} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** A note that is not on the site, as plain text in a muted panel. */
function OffSiteNote({ draft, label }: { draft: ReviewDraft; label: string }) {
  return (
    <div className="space-y-1 rounded-control bg-surface-muted px-3 py-2 text-sm">
      <p className="text-xs font-semibold text-fg-muted">{label}</p>
      <p className="whitespace-pre-wrap text-fg-secondary">{draft.note}</p>
    </div>
  );
}

/** One passage the Claude note writer's agents looked at, as a reviewer's
 *  card. The card holds the passage in its post, the note with "Your review"
 *  pills (Jim's or Nathan's vote is the review), an optional explanation after
 *  a vote, and the tools. The verdict sits at the top. Beside the card, or
 *  under it on a narrow screen, are each reviewer's vote with its explanation,
 *  the judge's guess, the agent's reasoning and earlier texts. A card shown
 *  outside the review page, such as on the note judge experiment page, has no
 *  pills, explanation box or tools, and shows `extra` in the side column. */
export function ReviewCard({ draft, liveNote, view, extra }: {
  draft: ReviewDraft;
  liveNote: NoteRow | undefined;
  view?: ReviewView;
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
    void refreshDrafts(client, view.request, [draft.id]);
  };
  return (
    <ClaimCard
      claim={liveNote?.claim ?? draftClaim(draft)}
      paragraph={liveNote?.claim.context_paragraph ?? draft.contextParagraph}
      post={post}
      byline={<CardHeader draft={draft} view={view} />}
      aside={<SideColumn draft={draft} view={view} extra={extra} />}
    >
      <div className="space-y-4">
        {!isNote(draft) ? (
          <p className="text-sm text-fg-secondary">{draft.reasoning}</p>
        ) : liveNote ? (
          <Note note={liveNote} shareUrl={shareUrl} review={!!view} onVoted={onVoted} />
        ) : draft.status === "removed" ? (
          <OffSiteNote draft={draft} label="Deleted from the site" />
        ) : (
          <NoteBox note={draftAsNote(draft)} status="needs_ratings" sourcesOpen />
        )}
        {view && explaining && <ReviewNoteForm draft={draft} view={view} placeholder="Optional: Explain your decision" onClose={() => setExplaining(false)} />}
        {view && isNote(draft) && draft.status !== "removed" && <Tools draft={draft} view={view} />}
      </div>
    </ClaimCard>
  );
}
