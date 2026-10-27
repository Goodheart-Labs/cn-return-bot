import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addToLeaderboard } from "@cn/core/bestNotes";
import {
  deleteDraftNote,
  explainVote,
  rewriteDraft,
  sendDraftMessage,
  skipDraft,
  type Reviewer,
  type ReviewDraft,
  type ReviewVote,
} from "@cn/core/claudeReview";
import { mintSelfVoteDonation } from "@cn/core/donations";
import { displayName } from "@cn/core/session";
import type { ClaimRef, FeedItemRow, NoteRow } from "@cn/core/types";
import type { Vote } from "@cn/core/votes";
import { useSession } from "@cn/features/auth/useSession";
import { Note } from "@cn/features/notes/Note";
import { NoteBox } from "@cn/features/notes/NoteBox";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { Textarea } from "@cn/ui/Field";
import { IconButton } from "@cn/ui/IconButton";
import { MoreIcon, TrashIcon, TrophyIcon } from "@cn/ui/icons";
import { Menu, MenuItem } from "@cn/ui/Menu";
import { useOutsidePress } from "@cn/ui/useOutsidePress";
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
const REVIEWERS: Reviewer[] = ["jim", "nathan"];
const VOTE_LABELS: Record<ReviewVote | "rejected", string> = { 1: "Helpful", 0: "Somewhat helpful", [-1]: "Not helpful", rejected: "Rejected" };
const VOTE_TONES: Record<ReviewVote | "rejected", string> = {
  1: "bg-positive-soft text-positive",
  0: "bg-caution-soft text-caution",
  [-1]: "bg-negative-soft text-negative",
  rejected: "bg-negative-soft text-negative",
};

/** Which of the note judge's two probabilities the reviewer chose to see. */
export interface JudgeShown {
  helpful: boolean;
  impactful: boolean;
}

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

function CardHeader({ draft }: { draft: ReviewDraft }) {
  const chip = verdictChip(draft);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg-secondary">{draft.post.creator}</p>
        {chip && <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", chip.tone)}>{chip.text}</span>}
      </div>
      <p className="text-xs text-fg-muted" title="The views count readers outside our team who were shown the notes on this post">
        {detailsLine(draft)}
      </p>
    </div>
  );
}

type Step =
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
 *  draft again, which keeps it in place even when its section changed. Both
 *  refresh the sidebar's counts. */
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
  return error ? (
    <span role="alert" className="text-sm text-negative">
      {error.message}
    </span>
  ) : null;
}

/** A small heading over each part of the side column. */
function AsideHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold text-fg-secondary">{children}</h3>;
}

/** Each reviewer's vote with the explanations they gave for it. An
 *  explanation names the vote it explains, which can differ from the current
 *  one after a change of mind. Old rejections show as "Rejected". */
function Reviews({ draft }: { draft: ReviewDraft }) {
  const rows = REVIEWERS.flatMap((reviewer) => {
    const vote = draft.reviewerVotes.find((v) => v.reviewer === reviewer)?.vote;
    const explanations = draft.explanations.filter((e) => e.actor === reviewer);
    const shownVote = vote ?? explanations.at(-1)?.vote ?? undefined;
    return vote === undefined && explanations.length === 0 ? [] : [{ reviewer, shownVote, explanations }];
  });
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <AsideHeading>Reviews</AsideHeading>
      {rows.map(({ reviewer, shownVote, explanations }) => (
        <div key={reviewer} className="space-y-1 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg">{PERSON[reviewer]}</span>
            {shownVote !== undefined && shownVote !== null && (
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", VOTE_TONES[shownVote])}>{VOTE_LABELS[shownVote]}</span>
            )}
          </p>
          {explanations.map((e) => (
            <p key={e.at} className="text-fg-secondary">
              {e.vote !== null && e.vote !== shownVote && <span className="text-fg-muted">Explaining {VOTE_LABELS[e.vote]}: </span>}
              {e.text}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}

const helpfulWord = (p: number) => (p >= 0.7 ? "Likely helpful" : p <= 0.4 ? "Likely not helpful" : "Could go either way");
const impactfulWord = (p: number) => (p >= 0.3 ? "A leaderboard candidate" : p >= 0.15 ? "Possibly for the leaderboard" : "Unlikely for the leaderboard");
const meterTone = (p: number, good: number, bad: number) => (p >= good ? "bg-positive-solid" : p <= bad ? "bg-negative-solid" : "bg-caution-solid");

function Meter({ label, value, word, tone }: { label: string; value: number; word: string; tone: string }) {
  const percent = Math.round(value * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-fg-secondary">{label}</span>
        <span className="font-semibold tabular-nums text-fg">{percent}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-muted" role="meter" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-fg-muted">{word}</p>
    </div>
  );
}

/** The note judge's guesses for the note's current text, as two meters. Each
 *  shows only while its checkbox in the sidebar is on. */
function Judge({ draft, shown }: { draft: ReviewDraft; shown: JudgeShown }) {
  if (!draft.judge || (!shown.helpful && !shown.impactful)) return null;
  const { pHelpful, pImpactful, reasoning } = draft.judge;
  return (
    <section className="space-y-3">
      <AsideHeading>The judge's guess</AsideHeading>
      {shown.helpful && <Meter label="Rated helpful" value={pHelpful} word={helpfulWord(pHelpful)} tone={meterTone(pHelpful, 0.7, 0.4)} />}
      {shown.impactful && <Meter label="Leaderboard" value={pImpactful} word={impactfulWord(pImpactful)} tone={meterTone(pImpactful, 0.3, 0.15)} />}
      <details className="text-sm text-fg-secondary">
        <summary className="cursor-pointer text-fg-muted">Why</summary>
        <p className="mt-1 whitespace-pre-wrap">{reasoning}</p>
      </details>
      <p className="text-xs text-fg-muted">A Claude's guess from the note alone. In tests it matched real ratings only weakly.</p>
    </section>
  );
}

function EarlierVersions({ draft }: { draft: ReviewDraft }) {
  if (draft.earlierVersions.length === 0) return null;
  return (
    <details className="text-sm text-fg-secondary">
      <summary className="cursor-pointer text-fg-muted">Earlier versions ({draft.earlierVersions.length})</summary>
      {draft.earlierVersions.map((v) => (
        <div key={v.at} className="mt-2 space-y-1 rounded-control bg-surface-muted px-3 py-2">
          <p className="whitespace-pre-wrap">{v.note}</p>
          {v.reason && <p className="text-xs text-fg-muted">{v.reason}</p>}
        </div>
      ))}
    </details>
  );
}

/** What sits beside the card on a wide screen and under it on a narrow one:
 *  the reviews, the judge's guess, the agent's reasoning and the note's
 *  earlier texts. */
function SideColumn({ draft, judgeShown, extra }: { draft: ReviewDraft; judgeShown?: JudgeShown; extra?: ReactNode }) {
  return (
    <div className="space-y-5 [overflow-wrap:anywhere]">
      <Reviews draft={draft} />
      {judgeShown && <Judge draft={draft} shown={judgeShown} />}
      {isNote(draft) && (
        <section className="space-y-1">
          <AsideHeading>The agent's reasoning</AsideHeading>
          <p className="text-sm text-fg-secondary">{draft.reasoning}</p>
        </section>
      )}
      <EarlierVersions draft={draft} />
      {extra}
    </div>
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
  const sources = proposal?.sources ?? draft.sources;
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
      {sources.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-fg-muted">{proposal ? "Sources of the proposal" : "The sources stay as they are"}</p>
          <ul className="space-y-0.5 text-xs">
            {sources.map((s) => (
              <li key={s.url} className="truncate">
                <a href={s.url} target="_blank" rel="noreferrer" className="text-link hover:underline">
                  {s.url}
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

/** The less frequent steps, behind a ⋯ button: Add to leaderboard for an
 *  approved note, and Delete from the site after a confirmation. */
function MoreMenu({ draft, view }: { draft: ReviewDraft; view: ReviewView }) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setConfirmingDelete(false);
  };
  const act = useReviewStep(draft, view, close);
  useOutsidePress(ref, open, close);
  const canAddToLeaderboard = draft.status === "posted" && draft.verdict === "approved" && !draft.onLeaderboard;
  return (
    <div ref={ref} className="relative">
      <IconButton label="More steps" onClick={() => (open ? close() : setOpen(true))}>
        <MoreIcon size={18} aria-hidden />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1">
          <Menu>
            {confirmingDelete ? (
              <>
                <p className="px-2 py-1.5 text-xs text-fg-secondary">Delete this note from the site? Its votes go with it.</p>
                <MenuItem onClick={() => act.mutate({ step: "delete" })} icon={<TrashIcon size={16} />} danger autoFocus>
                  Delete
                </MenuItem>
                <MenuItem onClick={close}>Cancel</MenuItem>
              </>
            ) : (
              <>
                {canAddToLeaderboard && (
                  <MenuItem onClick={() => act.mutate({ step: "leaderboard" })} icon={<TrophyIcon size={16} />} autoFocus>
                    Add to leaderboard
                  </MenuItem>
                )}
                <MenuItem onClick={() => setConfirmingDelete(true)} icon={<TrashIcon size={16} />} danger autoFocus={!canAddToLeaderboard}>
                  Delete from the site
                </MenuItem>
              </>
            )}
            {act.error && <p className="px-2 py-1.5 text-xs text-negative" role="alert">{act.error.message}</p>}
          </Menu>
        </div>
      )}
    </div>
  );
}

/** The card's tools in one row: chat, improve and skip, with the rare steps in
 *  the ⋯ menu. The chat and the improved version open below the row. */
function Tools({ draft, view }: { draft: ReviewDraft; view: ReviewView }) {
  const [open, setOpen] = useState<"chat" | "improve" | null>(draft.proposal ? "improve" : draft.messages.length > 0 ? "chat" : null);
  const [seenProposal, setSeenProposal] = useState(draft.proposal?.note);
  const skip = useReviewStep(draft, view);
  const toggle = (panel: "chat" | "improve") => setOpen(open === panel ? null : panel);
  const live = draft.status === "posted";
  // A proposal that arrives while the card is shown opens its box.
  if (draft.proposal && draft.proposal.note !== seenProposal) {
    setSeenProposal(draft.proposal.note);
    setOpen("improve");
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={open === "chat" ? "primary" : "secondary"} aria-expanded={open === "chat"} onClick={() => toggle("chat")}>
          Chat with Claude
        </Button>
        {live && (
          <Button variant={open === "improve" ? "primary" : "secondary"} aria-expanded={open === "improve"} onClick={() => toggle("improve")}>
            {draft.proposal ? "Improved version" : "Improve the note"}
          </Button>
        )}
        {(reviewOpen(draft) || draft.skipped) && (
          <Button variant="secondary" disabled={skip.isPending} onClick={() => skip.mutate({ step: "skip", skip: !draft.skipped })}>
            {draft.skipped ? "Unskip" : "Skip"}
          </Button>
        )}
        {draft.onLeaderboard && <span className="text-sm text-fg-muted">On the leaderboard</span>}
        <div className="ml-auto">{(live || draft.status === "posting") && <MoreMenu draft={draft} view={view} />}</div>
        <ErrorText error={skip.error} />
      </div>
      {open === "chat" && <Chat draft={draft} view={view} />}
      {open === "improve" && live && <ImprovedVersion draft={draft} view={view} onClose={() => setOpen(null)} />}
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
 *  outside a review section, such as on the note judge experiment page, has no
 *  pills, explanation box or tools, and shows `extra` in the side column. */
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
  return (
    <ClaimCard
      claim={liveNote?.claim ?? draftClaim(draft)}
      paragraph={liveNote?.claim.context_paragraph ?? draft.contextParagraph}
      post={post}
      byline={<CardHeader draft={draft} />}
      aside={<SideColumn draft={draft} judgeShown={judgeShown} extra={extra} />}
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
        {view && explaining && <ExplainBox draft={draft} view={view} onClose={() => setExplaining(false)} />}
        {view && isNote(draft) && draft.status !== "removed" && <Tools draft={draft} view={view} />}
      </div>
    </ClaimCard>
  );
}
