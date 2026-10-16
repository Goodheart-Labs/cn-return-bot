import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MAX_READER_NOTE_LENGTH, parseHighlightDraft, parseOpusDraft, type OpusDraft, type PassageQuestion } from "@cn/core/passageHighlights";
import type { PageItem } from "@cn/core/items";
import { fetchAskedPassages } from "@cn/core/passages";
import type { ReaderBlock } from "@cn/core/readerText";
import { displayName } from "@cn/core/session";
import { useSession } from "@cn/features/auth/useSession";
import { Button } from "@cn/ui/Button";
import { Checkbox, Input, Textarea } from "@cn/ui/Field";
import { Modal } from "@cn/ui/Modal";
import { Spinner } from "@cn/ui/Spinner";
import { renderAnswerMarkdown } from "../../lib/readerMarkdown";
import { useReader, type ReaderAnchor, type ReaderModule } from "../context";
import { DialogQuote } from "../DialogParts";
import { ASK_DOT, MarginSlot, SLOT_PRIORITY } from "../MarginSlot";
import { useHighlightPost, useNotePost, usePassageQuestions } from "./passageQuestions";
import { MIN_NOTE_LENGTH } from "./writeNote";

/** The database refuses a question longer than this. */
const MAX_QUESTION_LENGTH = 2000;
const SECOND_MS = 1000;

/** The feature that lets readers post each kind of draft. */
const DRAFT_FEATURE = { note: "highlight.note", forecast: "highlight.forecast", key_point: "highlight.keyPoint" } as const;
const DRAFT_NAME = { note: "note", forecast: "forecast", key_point: "key point" } as const;

function useSecondsSince(iso: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.round((now - Date.parse(iso)) / SECOND_MS));
}

/** Shows that Opus is still working. The seconds keep counting, so a long web
 *  search does not look like a page that hung. */
function Thinking({ question }: { question: PassageQuestion }) {
  const seconds = useSecondsSince(question.started_at ?? question.created_at);
  return <p role="status" className="reader-ask-thinking">
    <Spinner />
    <span>{question.status === "pending" ? "Waiting for Opus to start" : "Opus is thinking"} · {seconds} s</span>
  </p>;
}

/** A question asked about selected words is stored with those words in front,
 *  in curly quotes, so Opus knows which part of the passage is meant. */
const QUOTED_QUESTION = /^“([^”]+)” ([\s\S]*)$/;

/** Builds the stored question, which `splitQuestion` takes apart again. */
const joinQuestion = (quote: string | null, text: string) => (quote ? `“${quote.trim()}” ${text.trim()}` : text.trim());

/** The words a stored question was about, and what the reader typed. */
function splitQuestion(question: string): { quote: string | null; text: string } {
  const match = QUOTED_QUESTION.exec(question);
  return match ? { quote: match[1]!, text: match[2]! } : { quote: null, text: question };
}

/** One question in the chat: only what the reader typed, with the words it
 *  was about above it when they differ from the words this dialog is about. */
function AskedQuestion({ question, dialogQuote }: { question: string; dialogQuote: string | null }) {
  const { quote, text } = splitQuestion(question);
  return <>
    {quote && quote !== dialogQuote?.trim() && <p className="reader-ask-quote"><span>About</span> “{quote}”</p>}
    <p className="reader-ask-question">{text}</p>
  </>;
}

/** The reader's edits to a draft, as a draft again, or null while they are
 *  not postable. */
function editedDraft(kind: OpusDraft["kind"], text: string, probability: string): OpusDraft | null {
  if (kind === "note") return text.trim().length >= MIN_NOTE_LENGTH ? parseOpusDraft({ kind, text }) : null;
  if (kind === "key_point") return parseHighlightDraft({ kind, statement: text.trim() });
  return parseHighlightDraft({ kind, statement: text.trim(), probability: probability.trim() ? Number(probability) : null });
}

/** A draft Opus wrote, in a box under the chat. The reader edits it and posts
 *  it as their own, or discards it. */
function DraftEditor({ draft, anchor, onDone }: { draft: OpusDraft; anchor: ReaderAnchor; onDone: () => void }) {
  const { item, notify, refetchHighlights } = useReader();
  const { session } = useSession();
  const [text, setText] = useState(draft.kind === "note" ? draft.text : draft.statement);
  const [probability, setProbability] = useState(draft.kind === "forecast" ? String(draft.probability) : "");
  const [signed, setSigned] = useState(false);
  const notePost = useNotePost(item);
  const highlightPost = useHighlightPost(item);
  const name = DRAFT_NAME[draft.kind];
  const edited = editedDraft(draft.kind, text, probability);
  const signedIn = !!session && !session.user.is_anonymous;

  async function post() {
    if (!edited) return;
    if (edited.kind !== "note") {
      if (!(await highlightPost.post(anchor, edited, signed && session ? displayName(session) : null))) return;
      refetchHighlights();
      notify(`Your ${name} is posted.`);
      onDone();
      return;
    }
    if (!(await notePost.post(anchor, edited.text, signed))) return;
    notify("Your note is posted.");
    onDone();
  }

  return <form className="reader-draft-card reader-draft-editor" onSubmit={(event) => { event.preventDefault(); void post(); }}>
    <p className="reader-entry-kind">Suggested {name}</p>
    {draft.kind === "forecast" && <p className="reader-highlight-lead">
      This is a forecast of a <span className="reader-nowrap"><Input aria-label="Probability in percent" type="number" inputMode="numeric" min={0} max={100} step={1} required className="reader-highlight-probability" value={probability} onChange={(event) => setProbability(event.target.value)} />% chance of</span>
    </p>}
    {draft.kind === "key_point" && <p className="reader-highlight-lead">A key point in this article is</p>}
    <Textarea autoGrow aria-label={`The suggested ${name}`} rows={3} maxLength={draft.kind === "note" ? MAX_READER_NOTE_LENGTH : 2000} value={text} onChange={(event) => setText(event.target.value)} />
    {signedIn && <Checkbox checked={signed} onChange={setSigned}>Post as {displayName(session)}</Checkbox>}
    {(notePost.error || highlightPost.error) && <p role="alert" className="reader-dialog-error">{notePost.error || highlightPost.error}</p>}
    <div className="reader-draft-actions">
      <Button variant="quiet" onClick={onDone}>Discard</Button>
      <Button type="submit" disabled={!edited || notePost.posting || highlightPost.posting}>Post {name}</Button>
    </div>
    {notePost.login}
    {highlightPost.login}
  </form>;
}

/** Ask Opus as a chat in a dialog. Each answer appears once the intake service
 *  has written it, and a draft Opus wrote appears under the chat for the
 *  reader to edit and post. */
function AskDialog({ blockId, quote }: { blockId: string; quote: string | null }) {
  const { item, blocks, features, closeDialog } = useReader();
  const block = blocks.find((b) => b.id === blockId)!;
  const [text, setText] = useState("");
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const { questions, ask, waiting, error, login } = usePassageQuestions(item, block.text);
  const chat = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const anchor: ReaderAnchor = { blockId, text: quote ?? block.text, paragraph: block.text, partial: !!quote };
  const exchanges = questions.data ?? [];
  const drafting = features.has("opus.drafts");
  const draft = drafting ? exchanges
    .map((question) => ({ id: question.id, draft: parseOpusDraft(question.draft) }))
    .filter((entry): entry is { id: string; draft: OpusDraft } => !!entry.draft && features.has(DRAFT_FEATURE[entry.draft.kind]) && !settled.has(entry.id))
    .at(-1) : undefined;
  const lastStatus = exchanges.at(-1)?.status;

  // The modal moves focus to its first button when it opens, which happens
  // before this effect, so the question box takes focus here.
  useEffect(() => form.current?.querySelector("textarea")?.focus(), []);
  useEffect(() => {
    chat.current?.scrollTo({ top: chat.current.scrollHeight });
  }, [exchanges.length, lastStatus]);

  async function send() {
    if (await ask(joinQuestion(quote, text))) setText("");
  }

  return <Modal title="Ask Opus" onClose={closeDialog} widthClassName="max-w-[44rem]">
    <DialogQuote text={anchor.text} />
    {exchanges.length > 0 && <div ref={chat} className="reader-ask-chat">
      {exchanges.map((question) => <div key={question.id} className="reader-ask-exchange">
        <AskedQuestion question={question.question} dialogQuote={quote} />
        {question.status === "done" ? <div className="reader-answer">{renderAnswerMarkdown(question.answer ?? "")}</div>
          : question.status === "error" ? <p role="alert" className="reader-dialog-error">{question.error ?? "Opus could not answer. Please try again."}</p>
            : <Thinking question={question} />}
      </div>)}
    </div>}
    {draft && <DraftEditor key={draft.id} draft={draft.draft} anchor={anchor} onDone={() => setSettled((current) => new Set([...current, draft.id]))} />}
    <form ref={form} className="reader-dialog-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <Textarea autoGrow aria-label="Your question about this passage" maxLength={MAX_QUESTION_LENGTH} rows={2} value={text} onChange={(event) => setText(event.target.value)}
        placeholder={drafting ? "Ask about this passage, or ask Opus to draft a note." : "Ask about this passage."} />
      {error && !exchanges.some((question) => question.error === error) && <p role="alert" className="reader-dialog-error">{error}</p>}
      <div className="reader-ask-actions"><Button type="submit" disabled={waiting || !text.trim()}>{waiting ? "Waiting…" : "Ask"}</Button></div>
    </form>
    {login}
  </Modal>;
}

/** How many questions the reader asked about each passage, by block id. The
 *  question queries share one cache prefix, so asking a new question refreshes
 *  this too. */
export function useAskedQuestions(item: PageItem, blocks: readonly ReaderBlock[]): ReadonlyMap<string, number> {
  const { session } = useSession();
  const asked = useQuery({
    queryKey: ["passageQuestions", item.id, "asked", session?.user.id],
    queryFn: () => fetchAskedPassages(item.id, session!.user.id),
    enabled: !!session,
  });
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const passage of asked.data ?? []) {
      const block = blocks.find((candidate) => candidate.text === passage);
      if (block) counts.set(block.id, (counts.get(block.id) ?? 0) + 1);
    }
    return counts;
  }, [asked.data, blocks]);
}

/** A grey dot beside every passage the reader asked Opus about. It opens the
 *  conversation again. */
function AskEntries({ blockId }: { blockId: string }) {
  const { scope, askedQuestions, openDialog } = useReader();
  const count = askedQuestions.get(blockId) ?? 0;
  if (!count) return null;
  return <MarginSlot slotKey={`${scope}-ask-${blockId}`} colorClass={ASK_DOT} priority={SLOT_PRIORITY.ask}
    label={`Ask Opus · ${count} question${count === 1 ? "" : "s"}`} onOpen={() => openDialog({ kind: "ask", blockId, quote: null })} />;
}

function Dialogs() {
  const { dialog } = useReader();
  return dialog?.kind === "ask" ? <AskDialog key={`${dialog.blockId}-${dialog.quote ?? ""}`} blockId={dialog.blockId} quote={dialog.quote} /> : null;
}

/** Ask Opus about selected words or about a whole passage. */
export const askOpusModule: ReaderModule = {
  name: "askOpus",
  selectionActions: (api, block, quote) => [{
    feature: "highlight.askOpus",
    key: "ask",
    label: "Ask Opus",
    accessibleName: "Ask Opus about these words",
    onSelect: () => api.openDialog({ kind: "ask", blockId: block.id, quote }),
  }],
  passageActions: (api, block) => [{
    feature: "passage.askOpus",
    key: "ask",
    label: "Ask Opus about this paragraph",
    accessibleName: `Ask Opus about this paragraph: ${block.text.slice(0, 60)}`,
    onSelect: () => api.openDialog({ kind: "ask", blockId: block.id, quote: null }),
  }],
  marginCount: (api, blockId) => (api.askedQuestions.has(blockId) ? 1 : 0),
  MarginEntries: AskEntries,
  Dialogs,
};
