import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NoteRow } from "@cn/core/types";
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

function Decision({ draft }: { draft: Draft }) {
  const queryClient = useQueryClient();
  const [writing, setWriting] = useState<"reject" | "comment" | null>(null);
  const [text, setText] = useState("");
  const act = useMutation({
    mutationFn: (action: Action) => postAction(draft.file, action),
    onSuccess: () => {
      setWriting(null);
      setText("");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: DRAFTS_KEY }),
  });
  if (draft.review) {
    const verdict = draft.review.decision === "accepted" ? "Accepted and posted" : "Rejected";
    return (
      <p className="text-sm text-fg-muted">
        {verdict} {draft.review.reason && <>: {draft.review.reason}</>}
      </p>
    );
  }
  const send = () => act.mutate(writing === "reject" ? { action: "reject", reason: text } : { action: "comment", comment: text });
  return (
    <div className="space-y-2">
      {writing && (
        <Textarea
          className="w-full"
          rows={3}
          autoFocus
          placeholder={writing === "reject" ? "Why is this note not good? This goes to the agents as a lesson." : "What should change? Claude reads this and updates the note."}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {writing ? (
          <>
            <Button disabled={act.isPending || (writing === "comment" && !text.trim())} onClick={send}>
              {writing === "reject" ? "Reject" : "Send to Claude"}
            </Button>
            <Button variant="quiet" onClick={() => setWriting(null)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button disabled={act.isPending} onClick={() => act.mutate({ action: "accept" })}>
              Accept and post as JimMaar1
            </Button>
            <Button variant="secondary" disabled={act.isPending} onClick={() => setWriting("comment")}>
              Suggest a change
            </Button>
            <Button variant="secondary" disabled={act.isPending} onClick={() => setWriting("reject")}>
              Reject
            </Button>
          </>
        )}
        {act.isError && <span className="text-sm text-negative">{act.error.message}</span>}
      </div>
    </div>
  );
}

/** Jim's comments on the note and Claude's answers, oldest first. */
function Conversation({ draft }: { draft: Draft }) {
  if (!draft.feedback?.length) return null;
  return (
    <div className="space-y-2 text-sm">
      {draft.feedback.map((f) => (
        <div key={f.at} className="space-y-1">
          <p>
            <span className="font-medium">You:</span> {f.comment}
          </p>
          <p className="text-fg-secondary">
            <span className="font-medium">Claude:</span> {f.answer ? f.answer.reply : <span className="text-fg-muted">Working on it. The page updates when Claude answers.</span>}
          </p>
        </div>
      ))}
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

function DraftCard({ draft }: { draft: Draft }) {
  return (
    <Card className="space-y-4 p-4">
      <DraftHeader draft={draft} />
      <NoteBox note={draftAsNote(draft)} status="needs_ratings" sourcesOpen />
      <details className="text-sm text-fg-secondary">
        <summary className="cursor-pointer text-fg-muted">The agent's reasoning</summary>
        <p className="mt-1">{draft.reasoning}</p>
      </details>
      <EarlierVersions draft={draft} />
      <Conversation draft={draft} />
      <Decision draft={draft} />
    </Card>
  );
}

function SkippedPassage({ draft }: { draft: Draft }) {
  return (
    <Card className="space-y-2 p-4">
      <DraftHeader draft={draft} />
      <p className="text-sm text-fg-secondary">
        <span className="font-medium">{OUTCOME_LABELS[draft.outcome as Exclude<Draft["outcome"], "note">]}.</span> {draft.reasoning}
      </p>
    </Card>
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
    <main className="mx-auto max-w-[44rem] space-y-6 px-4 py-8">
      <h1 className="font-title text-2xl font-bold">Note review</h1>
      {drafts.isError && <p className="text-sm text-negative">{drafts.error.message}</p>}
      {drafts.isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Waiting for you ({waiting.length})</h2>
        {waiting.length === 0 && <p className="text-sm text-fg-muted">No notes are waiting. The page checks for new ones every 10 seconds.</p>}
        {waiting.map((d) => <DraftCard key={d.file} draft={d} />)}
      </section>
      {decided.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Decided ({decided.length})</h2>
          {decided.map((d) => <DraftCard key={d.file} draft={d} />)}
        </section>
      )}
      {skipped.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Looked at, no note ({skipped.length})</h2>
          {skipped.map((d) => <SkippedPassage key={d.file} draft={d} />)}
        </section>
      )}
    </main>
  );
}
