import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PageItem } from "@cn/core/items";
import {
  draftOutcome, highlightSentence, isWaiting, MAX_READER_NOTE_LENGTH, parseHighlightDraft, parseOpusDraft, QUESTION_BUDGET_ERROR,
  type DraftOutcome, type OpusDraft, type PassageQuestion,
} from "@cn/core/passageHighlights";
import { fetchAskedPassages } from "@cn/core/passages";
import type { ReaderBlock } from "@cn/core/readerText";
import { displayName } from "@cn/core/session";
import { useSession } from "@cn/features/auth/useSession";
import { Button } from "@cn/ui/Button";
import { Checkbox, Input, Textarea } from "@cn/ui/Field";
import { IconButton } from "@cn/ui/IconButton";
import { CloseIcon } from "@cn/ui/icons";
import { Sheet } from "@cn/ui/Modal";
import { Spinner } from "@cn/ui/Spinner";
import { renderAnswerMarkdown } from "../../lib/readerMarkdown";
import { useReader, type AskedPassage, type ReaderAnchor, type ReaderModule } from "../context";
import { ASK_DOT, MarginSlot, SLOT_PRIORITY } from "../MarginSlot";
import { highlightCardId } from "./highlights";
import { noteCardId } from "./notes";
import { ANSWER_POLL_MS, useHighlightPost, useNotePost, usePassageQuestions, useRecordDraftOutcome } from "./passageQuestions";
import { MIN_NOTE_LENGTH } from "./writeNote";

/** The database refuses a question longer than this. */
const MAX_QUESTION_LENGTH = 2000;
/** The database refuses a key point or forecast longer than this. */
const MAX_HIGHLIGHT_LENGTH = 2000;
const SECOND_MS = 1000;

/** The feature that lets readers post each kind of draft. */
const DRAFT_FEATURE = { note: "highlight.note", forecast: "highlight.forecast", key_point: "highlight.keyPoint" } as const;
const DRAFT_NAME = { note: "note", forecast: "forecast", key_point: "key point" } as const;

/** Shows a posted note or highlight beside the article: its card's element
 *  id, and the passage it sits beside. */
type ShowEntry = (elementId: string, blockId: string | undefined) => void;

export const askSlotKey = (scope: string, blockId: string) => `${scope}-ask-${blockId}`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Moves keyboard focus to an element as it appears, for example to the
 *  receipt that replaces a draft the reader just posted. */
const focusOnMount = (element: HTMLElement | null) => element?.focus();

function useSecondsSince(iso: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.round((now - Date.parse(iso)) / SECOND_MS));
}

/** Shows that Opus is still working. The seconds keep counting, so a long web
 *  search does not look like a page that hung. Screen readers hear only the
 *  words, because the counter would be read out every second. */
function Thinking({ question }: { question: PassageQuestion }) {
  const seconds = useSecondsSince(question.started_at ?? question.created_at);
  return <p className="reader-ask-thinking">
    <Spinner />
    <span role="status">{question.status === "pending" ? "Waiting for Opus to start" : "Opus is thinking"}</span>
    <span aria-hidden="true">· {seconds} s</span>
  </p>;
}

/** What the reader sees when Opus could not answer, and whether asking the
 *  same question again can help. Once the day's budget is spent it cannot. */
function questionFailure(error: string | null): { text: string; retryable: boolean } {
  return error === QUESTION_BUDGET_ERROR
    ? { text: "Opus has reached today's spending limit for questions. You can ask again after midnight UTC.", retryable: false }
    : { text: "Opus could not answer this question.", retryable: true };
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

/** The reader's edits to a draft, as a draft again, or null while they are
 *  not postable. */
function editedDraft(kind: OpusDraft["kind"], text: string, probability: string): OpusDraft | null {
  if (kind === "note") return text.trim().length >= MIN_NOTE_LENGTH ? parseOpusDraft({ kind, text }) : null;
  if (kind === "key_point") return parseHighlightDraft({ kind, statement: text.trim() });
  return parseHighlightDraft({ kind, statement: text.trim(), probability: probability.trim() ? Number(probability) : null });
}

const draftText = (draft: OpusDraft) => (draft.kind === "note" ? draft.text : highlightSentence(draft));

/** The reader's unsaved edits to each draft, by question id. They outlive the
 *  conversation, so closing it and opening it again keeps them. */
const draftEdits = new Map<string, { text: string; probability: string }>();

/** What the reader did with each draft during this visit, by question id,
 *  with null for a draft they restored. The page shows it at once and does
 *  not wait for the database, so a draft cannot be posted twice even when
 *  storing the outcome fails. */
const settledDrafts = new Map<string, DraftOutcome | null>();

/** A draft Opus wrote, in an editable box under its answer. The reader edits
 *  it and posts it as their own, or discards it. */
function DraftEditor({ question, draft, anchor, autoFocus, onSettled }: {
  question: PassageQuestion;
  draft: OpusDraft;
  anchor: ReaderAnchor;
  autoFocus: boolean;
  /** Runs when the reader has posted or discarded the draft. */
  onSettled: (outcome: DraftOutcome) => void;
}) {
  const { item, refetchHighlights, notify } = useReader();
  const { session } = useSession();
  const saved = draftEdits.get(question.id);
  const [text, setText] = useState(saved?.text ?? (draft.kind === "note" ? draft.text : draft.statement));
  const [probability, setProbability] = useState(saved?.probability ?? (draft.kind === "forecast" ? String(draft.probability) : ""));
  useEffect(() => { draftEdits.set(question.id, { text, probability }); }, [question.id, text, probability]);
  const [signed, setSigned] = useState(false);
  const [posting, setPosting] = useState(false);
  const notePost = useNotePost(item);
  const highlightPost = useHighlightPost(item);
  const name = DRAFT_NAME[draft.kind];
  const edited = editedDraft(draft.kind, text, probability);
  const signedIn = !!session && !session.user.is_anonymous;
  const signedName = signed && signedIn ? displayName(session) : null;
  const chance = Number(probability);
  const chanceInvalid = draft.kind === "forecast" && probability.trim() !== "" && !(Number.isInteger(chance) && chance >= 0 && chance <= 100);

  async function postDraft(postable: OpusDraft): Promise<string | null> {
    if (postable.kind === "note") return (await notePost.post(anchor, postable.text, signed))?.noteId ?? null;
    const postedId = await highlightPost.post(anchor, postable, signedName);
    if (postedId) refetchHighlights();
    return postedId;
  }

  async function post() {
    if (!edited) return;
    setPosting(true);
    try {
      const postedId = await postDraft(edited);
      if (!postedId) return;
      draftEdits.delete(question.id);
      notify(`Your ${name} is posted.`);
      onSettled({ kind: "posted", postedId });
    } finally {
      setPosting(false);
    }
  }

  return <form className="reader-draft-card reader-draft-editor" onSubmit={(event) => { event.preventDefault(); void post(); }}>
    <p className="reader-entry-kind">Suggested {name}</p>
    {draft.kind === "forecast" && <p className="reader-highlight-lead">
      This is a forecast of a <span className="reader-nowrap"><Input aria-label="Probability in percent" aria-invalid={chanceInvalid} type="number" inputMode="numeric" min={0} max={100} step={1} required className="reader-highlight-probability" value={probability} onChange={(event) => setProbability(event.target.value)} />% chance of</span>
    </p>}
    {draft.kind === "key_point" && <p className="reader-highlight-lead">A key point in this article is</p>}
    <Textarea autoGrow autoFocus={autoFocus} aria-label={`The suggested ${name}`} rows={3} maxLength={draft.kind === "note" ? MAX_READER_NOTE_LENGTH : MAX_HIGHLIGHT_LENGTH} value={text} onChange={(event) => setText(event.target.value)} />
    {chanceInvalid && <p className="reader-dialog-error">Give a chance from 0 to 100.</p>}
    {signedIn && <Checkbox checked={signed} onChange={setSigned}>Post as {displayName(session)}</Checkbox>}
    <p className="reader-draft-public">{signedName ? `Posts publicly as ${signedName}.` : "Posts publicly, without your name."} Other readers rate it.</p>
    {(notePost.error || highlightPost.error) && <p role="alert" className="reader-dialog-error">{notePost.error || highlightPost.error}</p>}
    <div className="reader-draft-actions">
      <Button variant="quiet" disabled={posting} onClick={() => onSettled({ kind: "discarded" })}>Discard</Button>
      <Button type="submit" disabled={!edited || posting}>{posting ? "Posting…" : `Post ${name}`}</Button>
    </div>
    {notePost.login}
    {highlightPost.login}
  </form>;
}

/** The passage a posted entry sits beside and its text, once the reader has
 *  loaded it. */
function findPosted<T extends { id: string }>(byBlock: ReadonlyMap<string, T[]>, id: string, textOf: (entry: T) => string): [string | undefined, string | undefined] {
  for (const [blockId, entries] of byBlock) {
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry) return [blockId, textOf(entry)];
  }
  return [undefined, undefined];
}

/** A draft the reader posted: what they posted, and the way to it. */
function PostedDraft({ draft, postedId, focus, onShow }: { draft: OpusDraft; postedId: string; focus: boolean; onShow: ShowEntry }) {
  const { scope, notesByBlock, highlightsByBlock } = useReader();
  const name = DRAFT_NAME[draft.kind];
  const [blockId, posted] = draft.kind === "note"
    ? findPosted(notesByBlock, postedId, (note) => note.note)
    : findPosted(highlightsByBlock, postedId, highlightSentence);
  return <div ref={focus ? focusOnMount : undefined} tabIndex={-1} className="reader-draft-card reader-draft-posted">
    <p className="reader-entry-kind">You posted this {name}</p>
    <p>{posted ?? draftText(draft)}</p>
    {posted && <button type="button" className="reader-text-button" onClick={() => onShow(draft.kind === "note" ? noteCardId(scope, postedId) : highlightCardId(scope, postedId), blockId)}>
      Show the {name}
    </button>}
  </div>;
}

/** The draft under one answer, or what the reader did with it. */
function ExchangeDraft({ question, draft, anchor, onShow }: { question: PassageQuestion; draft: OpusDraft; anchor: ReaderAnchor; onShow: ShowEntry }) {
  const { item, notify } = useReader();
  const recordOutcome = useRecordDraftOutcome(item.id);
  // Focus follows the reader's own action: from the draft to its receipt, and
  // back to the draft when they restore it.
  const [moveFocus, setMoveFocus] = useState(false);
  const outcome = settledDrafts.has(question.id) ? settledDrafts.get(question.id) : draftOutcome(question);
  // Stores the outcome with the question, so a later visit remembers it too.
  const settle = (next: DraftOutcome | null) => {
    settledDrafts.set(question.id, next);
    setMoveFocus(true);
    recordOutcome(question.id, next).catch(() => notify("This conversation could not save that, so it may offer the draft again after you reload the page."));
  };
  if (outcome?.kind === "posted") return <PostedDraft draft={draft} postedId={outcome.postedId} focus={moveFocus} onShow={onShow} />;
  if (outcome?.kind === "discarded") {
    return <p ref={moveFocus ? focusOnMount : undefined} tabIndex={-1} className="reader-draft-discarded">
      You discarded the suggested {DRAFT_NAME[draft.kind]}. <button type="button" className="reader-text-button" onClick={() => settle(null)}>Restore</button>
    </p>;
  }
  return <DraftEditor question={question} draft={draft} anchor={anchor} autoFocus={moveFocus} onSettled={settle} />;
}

/** One question, its answer, and the draft Opus wrote with it. */
function Exchange({ question, block, contextQuote, onRetry, onShow }: {
  question: PassageQuestion;
  block: ReaderBlock;
  /** The words the conversation is about now. A question about other words
   *  shows them above it. */
  contextQuote: string | null;
  onRetry: () => void;
  onShow: ShowEntry;
}) {
  const { features } = useReader();
  const { quote, text } = splitQuestion(question.question);
  const parsed = features.has("opus.drafts") ? parseOpusDraft(question.draft) : null;
  const draft = parsed && features.has(DRAFT_FEATURE[parsed.kind]) ? parsed : null;
  const failure = question.status === "error" ? questionFailure(question.error) : null;
  return <div className="reader-ask-exchange">
    {quote && quote !== contextQuote?.trim() && <p className="reader-ask-quote"><span>About</span> “{quote}”</p>}
    <p className="reader-ask-question">{text}</p>
    {question.status === "done" ? question.answer && <div className="reader-answer">{renderAnswerMarkdown(question.answer)}</div>
      : failure ? <div className={failure.retryable ? "reader-ask-error" : "reader-ask-error reader-ask-error-limit"}>
        <p>{failure.text}</p>
        {failure.retryable && <Button variant="secondary" onClick={onRetry}>Ask again</Button>}
      </div>
        : <Thinking question={question} />}
    {/* A draft belongs to the words its question was about, which may not be
      * the words the conversation is about now. */}
    {draft && <ExchangeDraft question={question} draft={draft} anchor={{ blockId: block.id, text: quote ?? block.text, paragraph: block.text, partial: !!quote }} onShow={onShow} />}
  </div>;
}

/** Scrolls the chat so the latest exchange starts at its top: the question
 *  just asked, or the beginning of the answer that just arrived. */
function showLatestExchange(chat: HTMLElement) {
  const latest = chat.lastElementChild;
  if (!latest) return;
  chat.scrollTop += latest.getBoundingClientRect().top - chat.getBoundingClientRect().top - parseFloat(getComputedStyle(chat).paddingTop);
}

/** The panel grows as answers arrive, and its question box can slide below
 *  the screen. The page then scrolls just enough to show the box again, but
 *  only while the panel's top is on screen: a reader who scrolled on to read
 *  the article stays where they are. */
function keepComposerInView(panel: HTMLElement, composer: HTMLElement | null) {
  const top = panel.getBoundingClientRect().top;
  if (top >= 0 && top < window.innerHeight) composer?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** What the empty conversation suggests asking. */
function emptyHint(features: ReadonlySet<string>): string {
  const drafts = features.has("opus.drafts") ? (["note", "key_point", "forecast"] as const).filter((kind) => features.has(DRAFT_FEATURE[kind])) : [];
  const draftHint = drafts.length ? ` It can also draft a ${DRAFT_NAME[drafts[0]!]} for you to edit and post.` : "";
  return `Ask whether a claim holds up, what a term means, or what the article leaves out.${draftHint}`;
}

/** The conversation with Opus about one passage. It is the same in the
 *  margin panel and in the phone sheet: a title row, the exchanges, which
 *  scroll, and the question box, which always stays in view. */
function AskPanel({ blockId, quote, onClose, onShow }: { blockId: string; quote: string | null; onClose: () => void; onShow: ShowEntry }) {
  const { item, blocks, features } = useReader();
  const block = blocks.find((b) => b.id === blockId)!;
  const [text, setText] = useState("");
  const { questions, ask, waiting, error, login } = usePassageQuestions(item, block.text);
  const panel = useRef<HTMLElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const exchanges = questions.data ?? [];
  const lastStatus = exchanges.at(-1)?.status;
  // The question box takes focus once the margin layout has shown the panel.
  // A card that was a dot is still hidden while React renders it, and a
  // hidden field cannot take focus.
  useEffect(() => composer.current?.querySelector("textarea")?.focus(), []);
  useEffect(() => {
    if (!chat.current || !panel.current) return;
    showLatestExchange(chat.current);
    keepComposerInView(panel.current, composer.current);
  }, [exchanges.length, lastStatus]);

  async function send() {
    if (await ask(joinQuestion(quote, text))) setText("");
  }
  // Escape closes the margin panel. In the phone sheet, and in a sign-in
  // dialog opened from the panel, the dialog itself handles Escape.
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !(event.target as Element).closest("dialog")) onClose();
  };

  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
  return <section ref={panel} className="reader-ask" aria-labelledby={titleId} onKeyDown={closeOnEscape}>
    <header className="reader-ask-header">
      <div>
        <h2 id={titleId} className="reader-ask-title">Ask Opus</h2>
        <p className="reader-ask-intro">Claude Opus is an AI model. It has read this article{features.has("opus.search") ? " and can search the web" : ""}.</p>
      </div>
      <IconButton label="Close Ask Opus" className="reader-ask-close" onClick={onClose}><CloseIcon size={16} aria-hidden /></IconButton>
    </header>
    <div ref={chat} className="reader-ask-chat">
      {exchanges.length === 0
        ? <p className="reader-ask-empty">{emptyHint(features)}</p>
        : exchanges.map((question) => <Exchange key={question.id} question={question} block={block} contextQuote={quote} onRetry={() => void ask(question.question)} onShow={onShow} />)}
    </div>
    <form ref={composer} className="reader-ask-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <p className="reader-ask-context">{quote ? <>About “{quote.trim()}”</> : "About this paragraph"}</p>
      <div className="reader-ask-input">
        <Textarea autoGrow aria-label={quote ? `Your question about “${quote.trim()}”` : "Your question about this paragraph"} maxLength={MAX_QUESTION_LENGTH} rows={1} value={text} onChange={(event) => setText(event.target.value)}
          placeholder={waiting ? "Opus is answering…" : "Ask a question"} />
        <Button type="submit" disabled={waiting || !text.trim()}>Ask</Button>
      </div>
      {error && <p role="alert" className="reader-dialog-error">{error}</p>}
    </form>
    {login}
  </section>;
}

/** Tells the reader when Opus finishes one of their questions, also while
 *  its conversation is closed. The message reaches screen readers too. */
function useAnswerAnnouncements(rows: readonly Pick<PassageQuestion, "id" | "status">[] | undefined, notify: (message: string) => void) {
  const waitingBefore = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!rows) return;
    const finished = rows.filter((row) => waitingBefore.current.has(row.id) && !isWaiting(row));
    waitingBefore.current = new Set(rows.filter(isWaiting).map((row) => row.id));
    if (finished.some((row) => row.status === "done")) notify("Opus answered your question.");
    else if (finished.length) notify("Opus could not answer your question.");
  }, [rows, notify]);
}

/** The reader's questions about each passage, by block id. The question
 *  queries share one cache prefix, so asking a new question refreshes this
 *  too. */
export function useAskedQuestions(item: PageItem, blocks: readonly ReaderBlock[], notify: (message: string) => void): ReadonlyMap<string, AskedPassage> {
  const { session } = useSession();
  const asked = useQuery({
    queryKey: ["passageQuestions", item.id, "asked", session?.user.id],
    queryFn: () => fetchAskedPassages(item.id, session!.user.id),
    enabled: !!session,
    refetchInterval: (query) => (query.state.data?.some(isWaiting) ? ANSWER_POLL_MS : false),
  });
  useAnswerAnnouncements(asked.data, notify);
  return useMemo(() => {
    const byBlock = new Map<string, AskedPassage>();
    for (const question of asked.data ?? []) {
      const block = blocks.find((candidate) => candidate.text === question.passage);
      if (!block) continue;
      const current = byBlock.get(block.id) ?? { count: 0, waiting: false };
      byBlock.set(block.id, { count: current.count + 1, waiting: current.waiting || isWaiting(question) });
    }
    return byBlock;
  }, [asked.data, blocks]);
}

/** The Ask Opus entry beside a passage. On a wide screen it is a grey dot
 *  that opens the conversation as a panel in the margin, laid out with the
 *  other cards. On a narrow screen it is one line under the passage that
 *  opens the conversation as a sheet. */
function AskEntries({ blockId }: { blockId: string }) {
  const { scope, wide, askedQuestions, asking, slotMode, ask, stopAsking, reveal } = useReader();
  const asked = askedQuestions.get(blockId);
  if (!asked && !(wide && asking?.blockId === blockId)) return null;
  const slotKey = askSlotKey(scope, blockId);
  const label = asked?.waiting ? "Ask Opus · Opus is answering" : asked ? `Ask Opus · ${plural(asked.count, "question")}` : "Ask Opus";
  // Only an open conversation is rendered, so a page with many asked
  // passages does not load all their conversations.
  const open = wide && slotMode(slotKey) === "opened";
  // Closing hands keyboard focus to the dot the panel shrinks to, once the
  // margin layout has drawn it.
  const close = () => {
    stopAsking(blockId);
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-slot="${CSS.escape(slotKey)}"] .reader-dot`)?.focus()));
  };
  return <MarginSlot slotKey={slotKey} colorClass={ASK_DOT} priority={SLOT_PRIORITY.ask} label={label} busy={asked?.waiting} closedUntilOpened
    onOpen={wide ? undefined : () => ask(blockId, null)}>
    {open && <AskPanel blockId={blockId} quote={asking?.blockId === blockId ? asking.quote : null} onClose={close} onShow={reveal} />}
  </MarginSlot>;
}

/** On a narrow screen there is no margin, so the conversation rises as a sheet. */
function Dialogs() {
  const { wide, asking, stopAsking, reveal } = useReader();
  if (wide || !asking) return null;
  const close = () => stopAsking(asking.blockId);
  return <Sheet label="Ask Opus" onClose={close} className="reader-ask-sheet">
    <AskPanel key={asking.blockId} blockId={asking.blockId} quote={asking.quote} onClose={close} onShow={(elementId, blockId) => { close(); reveal(elementId, blockId); }} />
  </Sheet>;
}

/** Ask Opus about selected words or about a whole passage. */
export const askOpusModule: ReaderModule = {
  name: "askOpus",
  selectionActions: (api, block, quote) => [{
    feature: "highlight.askOpus",
    key: "ask",
    label: "Ask Opus",
    accessibleName: "Ask Opus about these words",
    onSelect: () => api.ask(block.id, quote),
  }],
  passageActions: (api, block) => [{
    feature: "passage.askOpus",
    key: "ask",
    label: "Ask Opus about this paragraph",
    accessibleName: `Ask Opus about this paragraph: ${block.text.slice(0, 60)}`,
    onSelect: () => api.ask(block.id, null),
  }],
  marginCount: (api, blockId) => (api.askedQuestions.has(blockId) || (api.wide && api.asking?.blockId === blockId) ? 1 : 0),
  MarginEntries: AskEntries,
  Dialogs,
};
