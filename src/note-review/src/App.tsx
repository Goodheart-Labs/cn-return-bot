import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NoteRow } from "@cn/core/types";
import { ContextParagraph } from "@cn/features/notes/ContextParagraph";
import { NoteBox } from "@cn/features/notes/NoteBox";
import { queryClient } from "@cn/features/query/queryClient";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { Card } from "@cn/ui/Card";
import { Textarea } from "@cn/ui/Field";
import { Quote } from "@cn/ui/typography";
import type { Draft } from "./draft";

const DRAFTS_KEY = ["drafts"] as const;
/** How often the page looks for new drafts and for Claude's answers to comments. */
const REFRESH_MS = 10_000;

const KIND_LABELS: Record<Draft["kind"], string> = {
  small_mistake: "Small mistake",
  missing_context: "Missing context",
  wrong_or_misleading: "Wrong or misleading",
};

const OUTCOME_LABELS: Record<Exclude<Draft["outcome"], "note">, string> = {
  no_note_needed: "No note needed",
  too_hard: "Too hard to source",
};

const draftNoteId = (draft: Draft) => `draft:${draft.file}`;

/** Loads the drafts. Each draft's source quotes go into the query cache under
 *  the draft's own key, which is where the website's note box reads its
 *  "Source details" from. Nothing in the cache goes stale by time, so the note
 *  box never asks the database for these made-up ids. */
async function fetchDrafts(): Promise<Draft[]> {
  const response = await fetch("/api/drafts");
  if (!response.ok) throw new Error((await response.json()).error);
  const drafts: Draft[] = await response.json();
  for (const draft of drafts) {
    queryClient.setQueryData(
      queryKeys.sourceDetails(draftNoteId(draft)),
      draft.sources.map((s, i) => ({ ...s, sort_order: i })),
    );
  }
  return drafts;
}

type Action = { action: "accept" } | { action: "reject"; reason: string } | { action: "comment"; comment: string };

async function postAction(file: string, { action, ...body }: Action) {
  const response = await fetch(`/api/drafts/${file}/${action}`, { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json()).error);
}

/** The draft dressed as a note row, so the website's own note box can draw it. */
function draftAsNote(draft: Draft): NoteRow {
  const noteId = draftNoteId(draft);
  return {
    id: noteId,
    claim_id: noteId,
    note: draft.note,
    sources: draft.sources.map((s, i) => ({ url: s.url, sort_order: i })),
    has_source_details: true,
    helpful_count: 0,
    somewhat_helpful_count: 0,
    not_helpful_count: 0,
    author_id: "jim",
    author_name: "JimMaar1",
    improved_from_note_id: null,
    status: "draft",
    created_at: new Date().toISOString(),
    claim: {
      id: noteId,
      item_id: draft.itemId,
      claim: draft.claim,
      context_quote: draft.passage,
      context_paragraph: null,
      image_urls: [],
      updated_quote: null,
      context_url: draft.postUrl,
      start_seconds: null,
      end_seconds: null,
    },
  } as NoteRow;
}

function DraftHeader({ draft }: { draft: Draft }) {
  return (
    <div className="space-y-1">
      <a href={draft.postUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-link hover:underline">
        {draft.postTitle}
      </a>
      <p className="text-xs text-fg-muted">
        {draft.creator} · {KIND_LABELS[draft.kind]} · {draft.verificationRounds === 1 ? "1 source check" : `${draft.verificationRounds} source checks`}
      </p>
      <Quote className="text-sm">{draft.passage}</Quote>
    </div>
  );
}

function useDraftAction(draft: Draft, onSuccess: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: Action) => postAction(draft.file, action),
    onSuccess,
    onSettled: () => queryClient.invalidateQueries({ queryKey: DRAFTS_KEY }),
  });
}

function Decision({ draft }: { draft: Draft }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const act = useDraftAction(draft, () => setRejecting(false));
  if (draft.review) {
    const verdict = draft.review.decision === "accepted" ? "Accepted and posted" : "Rejected";
    return (
      <p className="text-sm text-fg-muted">
        {verdict} {draft.review.reason && <>: {draft.review.reason}</>}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {rejecting && (
        <Textarea className="w-full" rows={2} autoFocus placeholder="Why is this note not good? This goes to the agents as a lesson." value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {rejecting ? (
          <>
            <Button disabled={act.isPending} onClick={() => act.mutate({ action: "reject", reason })}>
              Reject
            </Button>
            <Button variant="quiet" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button disabled={act.isPending} onClick={() => act.mutate({ action: "accept" })}>
              Accept and post as JimMaar1
            </Button>
            <Button variant="secondary" disabled={act.isPending} onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </>
        )}
        {act.isError && <span className="text-sm text-negative">{act.error.message}</span>}
      </div>
    </div>
  );
}

/** A chat with Claude about one draft. Jim asks a question or suggests a
 *  change, and Claude answers here, changing the note if that was asked. */
function Chat({ draft }: { draft: Draft }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const act = useDraftAction(draft, () => setMessage(""));
  const messages = draft.feedback ?? [];
  if (!open && messages.length === 0) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Chat with Claude
      </Button>
    );
  }
  return (
    <div className="space-y-3 rounded-control border border-line p-3 text-sm">
      {messages.map((m) => (
        <div key={m.at} className="space-y-1">
          <p>
            <span className="font-medium">You:</span> {m.comment}
          </p>
          <p className="text-fg-secondary">
            <span className="font-medium">Claude:</span> {m.answer ? m.answer.reply : <span className="text-fg-muted">Working on it. The page updates when Claude answers.</span>}
          </p>
        </div>
      ))}
      <Textarea
        className="w-full"
        rows={2}
        placeholder="Ask a question or suggest a change. Claude answers here."
        value={message}
        onChange={(e) => setMessage(e.currentTarget.value)}
      />
      <div className="flex items-center gap-2">
        <Button disabled={act.isPending || !message.trim()} onClick={() => act.mutate({ action: "comment", comment: message })}>
          Send
        </Button>
        {act.isError && <span className="text-negative">{act.error.message}</span>}
      </div>
    </div>
  );
}

function EarlierVersions({ draft }: { draft: Draft }) {
  if (!draft.revisions?.length) return null;
  return (
    <details className="text-sm text-fg-secondary">
      <summary className="cursor-pointer text-fg-muted">Earlier versions ({draft.revisions.length})</summary>
      {draft.revisions.map((r) => (
        <Quote key={r.at} className="mt-2 text-sm">
          {r.previousNote}
        </Quote>
      ))}
    </details>
  );
}

/** A card with the post's paragraph around the passage, laid out as on the
 *  website: beside the card on wide screens, behind a toggle on narrow ones. */
function CardWithContext({ draft, className, children }: { draft: Draft; className: string; children: ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const paragraph = draft.contextParagraph;
  return (
    <div className="items-start xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,40rem)_minmax(0,1fr)] xl:gap-4">
      {paragraph && (
        <div className="hidden xl:col-start-1 xl:row-start-1 xl:block">
          <ContextParagraph paragraph={paragraph} quote={draft.passage} fitTo={cardRef} />
        </div>
      )}
      <Card ref={cardRef} className={`mx-auto w-full max-w-[40rem] p-4 xl:col-start-2 xl:row-start-1 xl:mx-0 xl:max-w-none ${className}`}>
        <DraftHeader draft={draft} />
        {paragraph && (
          <details className="text-sm xl:hidden">
            <summary className="cursor-pointer text-fg-muted">Show surrounding context</summary>
            <div className="mt-2">
              <ContextParagraph paragraph={paragraph} quote={draft.passage} bare />
            </div>
          </details>
        )}
        {children}
      </Card>
    </div>
  );
}

function DraftCard({ draft }: { draft: Draft }) {
  return (
    <CardWithContext draft={draft} className="space-y-4">
      <NoteBox note={draftAsNote(draft)} status="needs_ratings" sourcesOpen />
      <details className="text-sm text-fg-secondary">
        <summary className="cursor-pointer text-fg-muted">The agent's reasoning</summary>
        <p className="mt-1">{draft.reasoning}</p>
      </details>
      <EarlierVersions draft={draft} />
      <Chat draft={draft} />
      <Decision draft={draft} />
    </CardWithContext>
  );
}

function SkippedPassage({ draft }: { draft: Draft }) {
  return (
    <CardWithContext draft={draft} className="space-y-2">
      <p className="text-sm text-fg-secondary">
        <span className="font-medium">{OUTCOME_LABELS[draft.outcome as Exclude<Draft["outcome"], "note">]}.</span> {draft.reasoning}
      </p>
      <Chat draft={draft} />
    </CardWithContext>
  );
}

/** Every draft the note-finding agents wrote. Notes waiting for a decision come
 *  first, then the decided ones, then the passages the agents looked at but
 *  wrote no note on. */
export function App() {
  const drafts = useQuery({ queryKey: DRAFTS_KEY, queryFn: fetchDrafts, refetchInterval: REFRESH_MS });
  const all = drafts.data ?? [];
  const notes = all.filter((d) => d.outcome === "note");
  const waiting = notes.filter((d) => !d.review);
  const decided = notes.filter((d) => d.review);
  const skipped = all.filter((d) => d.outcome !== "note");
  return (
    <main className="space-y-6 px-4 py-8">
      <h1 className="mx-auto max-w-[40rem] font-title text-2xl font-bold">Note review</h1>
      {drafts.isError && <p className="mx-auto max-w-[40rem] text-sm text-negative">{drafts.error.message}</p>}
      {drafts.isLoading && <p className="mx-auto max-w-[40rem] text-sm text-fg-muted">Loading…</p>}
      <section className="space-y-4">
        <h2 className="mx-auto max-w-[40rem] text-lg font-semibold">Waiting for you ({waiting.length})</h2>
        {waiting.length === 0 && <p className="mx-auto max-w-[40rem] text-sm text-fg-muted">No notes are waiting. The page checks for new ones every 10 seconds.</p>}
        {waiting.map((d) => <DraftCard key={d.file} draft={d} />)}
      </section>
      {decided.length > 0 && (
        <section className="space-y-4">
          <h2 className="mx-auto max-w-[40rem] text-lg font-semibold">Decided ({decided.length})</h2>
          {decided.map((d) => <DraftCard key={d.file} draft={d} />)}
        </section>
      )}
      {skipped.length > 0 && (
        <section className="space-y-4">
          <h2 className="mx-auto max-w-[40rem] text-lg font-semibold">Looked at, no note ({skipped.length})</h2>
          {skipped.map((d) => <SkippedPassage key={d.file} draft={d} />)}
        </section>
      )}
    </main>
  );
}
