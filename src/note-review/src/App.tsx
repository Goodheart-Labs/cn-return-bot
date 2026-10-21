import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NoteRow } from "@cn/core/types";
import { ContextParagraph } from "@cn/features/notes/ContextParagraph";
import { NoteBox } from "@cn/features/notes/NoteBox";
import { queryClient } from "@cn/features/query/queryClient";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { Card } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { Textarea } from "@cn/ui/Field";
import { Quote } from "@cn/ui/typography";
import type { PostedAs, Reviewer, ReviewDraft, ReviewState } from "./draft";

const STATE_KEY = ["review-state"] as const;
/** How often the page looks for new notes and for Claude's answers. */
const REFRESH_MS = 10_000;

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
const PERSON: Record<Reviewer | "claude", string> = { jim: "Jim", nathan: "Nathan", claude: "Claude" };
const POSTED_AS: Record<PostedAs, string> = { ai: "an AI note", jim: "JimMaar1", nathan: "NathanpmYoung" };

const noteBoxId = (draft: ReviewDraft) => `draft:${draft.id}`;

/** Loads the review state. Each draft's source quotes go into the query cache
 *  under the draft's own key, which is where the website's note box reads its
 *  "Source details" from, so it never asks the database for these ids. */
async function fetchState(): Promise<ReviewState> {
  const response = await fetch("/api/drafts");
  if (!response.ok) throw new Error((await response.json()).error);
  const state: ReviewState = await response.json();
  for (const draft of state.drafts) {
    queryClient.setQueryData(
      queryKeys.sourceDetails(noteBoxId(draft)),
      draft.sources.map((s, i) => ({ ...s, sort_order: i })),
    );
  }
  return state;
}

type Action =
  | { action: "approve" }
  | { action: "reject"; reason: string }
  | { action: "rewrite"; note: string; postedAs: PostedAs }
  | { action: "message"; text: string };

async function postAction(draftId: string, { action, ...body }: Action) {
  const response = await fetch(`/api/drafts/${draftId}/${action}`, { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json()).error);
}

function useDraftAction(draft: ReviewDraft, onSuccess?: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: Action) => postAction(draft.id, action),
    onSuccess,
    onSettled: () => client.invalidateQueries({ queryKey: STATE_KEY }),
  });
}

/** The draft dressed as a note row, so the website's own note box can draw it. */
function draftAsNote(draft: ReviewDraft): NoteRow {
  const id = noteBoxId(draft);
  const author = draft.postedAs && draft.postedAs !== "ai" ? POSTED_AS[draft.postedAs] : null;
  return {
    id,
    claim_id: id,
    note: draft.note,
    sources: draft.sources.map((s, i) => ({ url: s.url, sort_order: i })),
    has_source_details: true,
    helpful_count: 0,
    somewhat_helpful_count: 0,
    not_helpful_count: 0,
    author_id: author,
    author_name: author,
    improved_from_note_id: null,
    status: "draft",
    created_at: draft.createdAt,
    claim: {
      id,
      item_id: draft.itemId,
      claim: draft.claim,
      context_quote: draft.passage,
      context_paragraph: null,
      image_urls: [],
      updated_quote: null,
      context_url: draft.post.url,
      start_seconds: null,
      end_seconds: null,
    },
  } as NoteRow;
}

function statusLine(draft: ReviewDraft): string {
  if (draft.status === "awaiting_approval") return "Waiting for approval";
  if (draft.status === "rejected") return `Rejected by ${PERSON[draft.reviewedBy ?? "jim"]}`;
  if (draft.status !== "posted") return NO_NOTE_LABELS[draft.outcome as Exclude<ReviewDraft["outcome"], "note">];
  const posted = `Posted as ${POSTED_AS[draft.postedAs ?? "ai"]}`;
  return draft.reviewedBy ? `${posted}, approved by ${PERSON[draft.reviewedBy]}` : `${posted}, not reviewed yet`;
}

function DraftHeader({ draft }: { draft: ReviewDraft }) {
  return (
    <div className="space-y-1">
      <a href={draft.post.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-link hover:underline">
        {draft.post.title}
      </a>
      <p className="text-xs text-fg-muted">
        {draft.post.creator} · {KIND_LABELS[draft.kind]} · {statusLine(draft)}
      </p>
      <Quote className="text-sm">{draft.passage}</Quote>
    </div>
  );
}

/** A card with the post's paragraph around the passage, laid out as on the
 *  website: beside the card on wide screens, behind a toggle on narrow ones. */
function CardWithContext({ draft, children }: { draft: ReviewDraft; children: ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const paragraph = draft.contextParagraph;
  return (
    <div className="items-start xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,40rem)_minmax(0,1fr)] xl:gap-4">
      {paragraph && (
        <div className="hidden xl:col-start-1 xl:row-start-1 xl:block">
          <ContextParagraph paragraph={paragraph} quote={draft.passage} fitTo={cardRef} />
        </div>
      )}
      <Card ref={cardRef} className="mx-auto w-full max-w-[40rem] space-y-4 p-4 xl:col-start-2 xl:row-start-1 xl:mx-0 xl:max-w-none">
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

function EarlierVersions({ draft }: { draft: ReviewDraft }) {
  if (draft.earlierVersions.length === 0) return null;
  return (
    <details className="text-sm text-fg-secondary">
      <summary className="cursor-pointer text-fg-muted">Earlier versions ({draft.earlierVersions.length})</summary>
      {draft.earlierVersions.map((v) => (
        <div key={v.at} className="mt-2 space-y-1">
          <Quote className="text-sm">{v.note}</Quote>
          {v.reason && <p className="text-xs text-fg-muted">{v.reason}</p>}
        </div>
      ))}
    </details>
  );
}

/** A chat with Claude about one draft. A reviewer asks a question or suggests
 *  a change, and Claude answers here, changing the note if that was asked. */
function Chat({ draft }: { draft: ReviewDraft }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const act = useDraftAction(draft, () => setText(""));
  const waiting = draft.messages.at(-1)?.actor !== "claude" && draft.messages.length > 0;
  if (!open && draft.messages.length === 0) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Chat with Claude
      </Button>
    );
  }
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) act.mutate({ action: "message", text: text.trim() });
  };
  return (
    <form onSubmit={send} className="space-y-3 rounded-control border border-line p-3 text-sm">
      {draft.messages.map((m) => (
        <p key={m.at} className={m.actor === "claude" ? "text-fg-secondary" : undefined}>
          <span className="font-medium">{PERSON[m.actor]}:</span> {m.text}
        </p>
      ))}
      {waiting && <p className="text-fg-muted">Claude is working on it. The page updates when Claude answers.</p>}
      <Textarea className="w-full" rows={2} placeholder="Ask a question or suggest a change. Claude answers here." value={text} onChange={(e) => setText(e.currentTarget.value)} />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={act.isPending || !text.trim()}>
          Send
        </Button>
        {act.isError && <span className="text-negative">{act.error.message}</span>}
      </div>
    </form>
  );
}

function RewriteForm({ draft, reviewer, onDone }: { draft: ReviewDraft; reviewer: Reviewer; onDone: () => void }) {
  const [note, setNote] = useState(draft.note);
  const [postedAs, setPostedAs] = useState<PostedAs>(reviewer);
  const act = useDraftAction(draft, onDone);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    act.mutate({ action: "rewrite", note, postedAs });
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea className="w-full" rows={4} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={`posted-as-${draft.id}`}>Post as</label>
        <select
          id={`posted-as-${draft.id}`}
          className="rounded-control border border-line-input bg-surface px-2 py-1.5 text-sm text-fg"
          value={postedAs}
          onChange={(e) => setPostedAs(e.currentTarget.value as PostedAs)}
        >
          {(Object.keys(POSTED_AS) as PostedAs[]).map((p) => (
            <option key={p} value={p}>
              {POSTED_AS[p]}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={act.isPending || !note.trim() || note === draft.note}>
          {draft.status === "posted" ? "Replace the posted note" : "Save"}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        {act.isError && <span className="text-negative">{act.error.message}</span>}
      </div>
    </form>
  );
}

function Actions({ draft, reviewer }: { draft: ReviewDraft; reviewer: Reviewer }) {
  const [mode, setMode] = useState<"rewrite" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const act = useDraftAction(draft, () => setMode(null));
  if (draft.status !== "posted" && draft.status !== "awaiting_approval") return null;
  if (mode === "rewrite") return <RewriteForm draft={draft} reviewer={reviewer} onDone={() => setMode(null)} />;
  if (mode === "reject") {
    return (
      <div className="space-y-2">
        <Textarea className="w-full" rows={2} autoFocus placeholder="Why is this note not good? Claude learns from this." value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={act.isPending} onClick={() => act.mutate({ action: "reject", reason })}>
            {draft.status === "posted" ? "Reject and delete the note" : "Reject"}
          </Button>
          <Button variant="quiet" onClick={() => setMode(null)}>
            Cancel
          </Button>
          {act.isError && <span className="text-sm text-negative">{act.error.message}</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!draft.reviewedBy && (
        <Button disabled={act.isPending} onClick={() => act.mutate({ action: "approve" })}>
          {draft.status === "awaiting_approval" ? "Approve and post" : "Approve"}
        </Button>
      )}
      <Button variant="secondary" disabled={act.isPending} onClick={() => setMode("rewrite")}>
        Rewrite
      </Button>
      <Button variant="secondary" disabled={act.isPending} onClick={() => setMode("reject")}>
        Reject
      </Button>
      {act.isError && <span className="text-sm text-negative">{act.error.message}</span>}
    </div>
  );
}

function DraftCard({ draft, reviewer }: { draft: ReviewDraft; reviewer: Reviewer }) {
  const isNote = draft.status === "posted" || draft.status === "awaiting_approval" || draft.status === "rejected";
  return (
    <CardWithContext draft={draft}>
      {isNote ? (
        <NoteBox note={draftAsNote(draft)} status="needs_ratings" sourcesOpen />
      ) : (
        <p className="text-sm text-fg-secondary">{draft.reasoning}</p>
      )}
      {isNote && (
        <details className="text-sm text-fg-secondary">
          <summary className="cursor-pointer text-fg-muted">The agent's reasoning</summary>
          <p className="mt-1">{draft.reasoning}</p>
        </details>
      )}
      <EarlierVersions draft={draft} />
      <Chat draft={draft} />
      <Actions draft={draft} reviewer={reviewer} />
    </CardWithContext>
  );
}

interface Page {
  id: string;
  title: string;
  drafts: ReviewDraft[];
  empty: string;
}

function pagesOf(drafts: ReviewDraft[]): Page[] {
  const posted = drafts.filter((d) => d.status === "posted");
  return [
    { id: "unreviewed", title: "Posted, not reviewed", drafts: posted.filter((d) => !d.reviewedBy), empty: "Every posted note has been reviewed." },
    { id: "waiting", title: "Waiting for approval", drafts: drafts.filter((d) => d.status === "awaiting_approval"), empty: "No note is waiting for approval." },
    { id: "approved", title: "Approved", drafts: posted.filter((d) => d.reviewedBy), empty: "No note has been approved yet." },
    { id: "rejected", title: "Rejected", drafts: drafts.filter((d) => d.status === "rejected"), empty: "No note has been rejected." },
    { id: "no-note", title: "No note", drafts: drafts.filter((d) => d.status === "not_a_note"), empty: "No passage ended without a note." },
  ];
}

/** The page named in the address, so a reload or a shared link opens it. */
function initialPageId(): string {
  return window.location.hash.slice(1) || "unreviewed";
}

/** Pages whose drafts wait for a reviewer get a highlighted count. */
const NEEDS_REVIEWER = new Set(["unreviewed", "waiting"]);

function Tab({ page, active, onSelect }: { page: Page; active: boolean; onSelect: () => void }) {
  const count = page.drafts.length;
  const highlighted = NEEDS_REVIEWER.has(page.id) && count > 0;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "relative flex shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
        "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
        active ? "text-fg after:bg-primary" : "text-fg-muted hover:text-fg after:bg-transparent",
      )}
    >
      {page.title}
      <span
        className={cn(
          "min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs tabular-nums",
          highlighted ? "bg-caution-soft text-caution" : active ? "bg-tint text-link" : "bg-surface-muted text-fg-secondary",
        )}
      >
        {count}
      </span>
    </button>
  );
}

/** Turns the approval step on or off for every reviewer. While it is on,
 *  Claude's new notes wait on the "Waiting for approval" page. */
function ApprovalSwitch({ approvalRequired }: { approvalRequired: boolean }) {
  const client = useQueryClient();
  const toggle = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/drafts/settings", { method: "POST", body: JSON.stringify({ approvalRequired: !approvalRequired }) });
      if (!response.ok) throw new Error((await response.json()).error);
    },
    onSettled: () => client.invalidateQueries({ queryKey: STATE_KEY }),
  });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={approvalRequired}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate()}
      title={approvalRequired ? "New notes wait for approval. Click to post them at once" : "New notes go up at once. Click to make them wait for approval"}
      className="flex items-center gap-2 rounded-full border border-line px-2 py-0.5 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <span className={cn("relative h-3.5 w-6 rounded-full transition-colors", approvalRequired ? "bg-primary" : "bg-line-strong")}>
        <span className={cn("absolute top-0.5 h-2.5 w-2.5 rounded-full bg-surface transition-all", approvalRequired ? "left-3" : "left-0.5")} />
      </span>
      Approval before posting
    </button>
  );
}

function TopBar({ pages, current, onSelect, state }: { pages: Page[]; current: string; onSelect: (id: string) => void; state?: ReviewState }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-stretch gap-x-6 px-4">
        <span className="flex items-center py-3 font-title text-lg font-bold">Note review</span>
        <nav role="tablist" aria-label="Sections" className="-mb-px flex min-w-0 overflow-x-auto">
          {pages.map((p) => (
            <Tab key={p.id} page={p} active={p.id === current} onSelect={() => onSelect(p.id)} />
          ))}
        </nav>
        {state && (
          <div className="ml-auto flex items-center gap-2 py-3 text-xs text-fg-muted">
            <span>Reviewing as {PERSON[state.reviewer]}</span>
            <span className="rounded-full border border-line px-2 py-0.5">{state.writer === "claude" ? "Claude writes" : "Pipeline writes"}</span>
            <ApprovalSwitch approvalRequired={state.approvalRequired} />
          </div>
        )}
      </div>
    </header>
  );
}

const newestFirst = (a: ReviewDraft, b: ReviewDraft) => b.createdAt.localeCompare(a.createdAt);

/** Every passage the Claude note writer's agents looked at. Each group is a
 *  page of its own, picked in the top bar. */
export function App() {
  const state = useQuery({ queryKey: STATE_KEY, queryFn: fetchState, refetchInterval: REFRESH_MS });
  const [pageId, setPageId] = useState(initialPageId);
  const drafts = [...(state.data?.drafts ?? [])].sort(newestFirst);
  const reviewer = state.data?.reviewer ?? "jim";
  const pages = pagesOf(drafts);
  const page = pages.find((p) => p.id === pageId) ?? pages[0]!;
  const select = (id: string) => {
    setPageId(id);
    window.history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top: 0 });
  };
  return (
    <>
      <TopBar pages={pages} current={page.id} onSelect={select} state={state.data} />
      <main className="space-y-6 px-4 py-6">
        {state.isError && <p className="mx-auto max-w-[40rem] text-sm text-negative">{state.error.message}</p>}
        {state.isLoading && <p className="mx-auto max-w-[40rem] text-sm text-fg-muted">Loading…</p>}
        {state.data && page.drafts.length === 0 && <p className="mx-auto max-w-[40rem] py-12 text-center text-sm text-fg-muted">{page.empty}</p>}
        {page.drafts.map((d) => (
          <DraftCard key={d.id} draft={d} reviewer={reviewer} />
        ))}
      </main>
    </>
  );
}
