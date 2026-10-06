import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { displayName } from "@cn/core/session";
import { ensureUser } from "@cn/core/auth";
import type { PageItem } from "@cn/core/items";
import { highlightSentence, parseHighlightDraft, type HighlightDraft, type PassageHighlight, type PassageQuestion } from "@cn/core/passageHighlights";
import { askPassageQuestion, deletePassageHighlight, fetchHighlightVotes, fetchPassageQuestions, postPassageHighlight, subscribeToPassages, voteOnHighlight } from "@cn/core/passages";
import { useSession } from "@cn/features/auth/useSession";
import { ratingQuestion } from "@cn/features/notes/NoteBox";
import { VoteRatings } from "@cn/features/notes/VoteRatings";
import { Button } from "@cn/ui/Button";
import { Checkbox, Input, Textarea } from "@cn/ui/Field";
import { Modal } from "@cn/ui/Modal";
import { renderAnswerMarkdown } from "../lib/readerMarkdown";
import { LoginModal } from "./LoginModal";
import type { ReaderAnchor } from "./ReaderWriteNote";

function usePassageQuestions(item: PageItem, passage: string, onAnswered?: (question: PassageQuestion) => void) {
  const { session } = useSession();
  const client = useQueryClient();
  const [login, setLogin] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const waitingFor = useRef<string | null>(null);
  const key = ["passageQuestions", item.id, passage, session?.user.id];
  const questions = useQuery({
    queryKey: key,
    queryFn: () => fetchPassageQuestions(item.id, passage, session!.user.id),
    enabled: !!session,
    refetchInterval: (query) => (waitingFor.current || query.state.data?.some((q) => q.status === "pending" || q.status === "answering")) ? 5000 : false,
  });
  useEffect(() => subscribeToPassages(item.id, () => { void client.invalidateQueries({ queryKey: ["passageQuestions", item.id] }); }), [item.id, client]);
  useEffect(() => {
    const question = questions.data?.find((q) => q.id === waitingFor.current);
    if (!question || (question.status !== "done" && question.status !== "error")) return;
    waitingFor.current = null;
    if (question.status === "error") setError(question.error ?? "Could not answer.");
    onAnswered?.(question);
  }, [questions.data, onAnswered]);
  async function ask(text: string) {
    setSending(true);
    setError("");
    try {
      const user = await ensureUser();
      if (!user) { setLogin(true); return false; }
      waitingFor.current = await askPassageQuestion(item.id, passage, text, user.id);
      await client.invalidateQueries({ queryKey: ["passageQuestions", item.id] });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : (err as { message?: string }).message ?? "Could not send your question.");
      return false;
    } finally { setSending(false); }
  }
  const waiting = sending || questions.data?.some((q) => q.status === "pending" || q.status === "answering");
  return { questions, ask, waiting, error, login: <LoginModal open={login} onClose={() => setLogin(false)} /> };
}

function useHighlightPost(item: PageItem) {
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  async function post(anchor: Pick<ReaderAnchor, "text" | "paragraph">, highlight: HighlightDraft, authorName: string | null = null) {
    setPosting(true);
    setError("");
    try {
      const user = await ensureUser();
      if (!user) { setLogin(true); return false; }
      await postPassageHighlight({ item_id: item.id, kind: highlight.kind, quote: anchor.text, context_paragraph: anchor.paragraph, statement: highlight.statement.trim(), probability: highlight.kind === "forecast" ? highlight.probability : null, author_id: user.id, author_name: authorName });
      return true;
    } catch {
      setError("Could not post your highlight. Please try again.");
      return false;
    } finally { setPosting(false); }
  }
  return { post, posting, error, login: <LoginModal open={login} onClose={() => setLogin(false)} /> };
}

function DraftSuggestion({ draft, posting, onUse, onEdit }: { draft: HighlightDraft; posting: boolean; onUse: () => void; onEdit: () => void }) {
  return <div className="reader-draft-card">
    <p className="reader-draft-label">Suggested {draft.kind === "forecast" ? "forecast" : "key point"}</p>
    <p>{highlightSentence(draft)}</p>
    <div className="reader-form-actions">
      <Button disabled={posting} onClick={onUse}>Use this draft</Button>
      <Button variant="secondary" onClick={onEdit}>Edit</Button>
    </div>
  </div>;
}

export function ReaderPassageQuestions({ item, passage, quote, onDraft }: { item: PageItem; passage: string; quote?: string | null; onDraft: (draft: HighlightDraft) => void }) {
  // A question from highlighted words starts with those words quoted, so Opus 5.5 sees which part of the passage is meant.
  const [text, setText] = useState(quote ? `“${quote.trim()}” ` : "");
  const { questions, ask, waiting, error, login } = usePassageQuestions(item, passage);
  const poster = useHighlightPost(item);
  const client = useQueryClient();
  const [posted, setPosted] = useState<string[]>([]);
  async function use(id: string, draft: HighlightDraft) {
    if (!await poster.post({ text: passage, paragraph: passage }, draft)) return;
    setPosted((ids) => [...ids, id]);
    await client.invalidateQueries({ queryKey: ["passageHighlights", item.id] });
  }
  return <section className="reader-question-panel">
    <h3>Ask Opus 5.5</h3>
    {questions.data?.map((q) => {
      const draft = parseHighlightDraft(q.draft);
      return <div key={q.id} className="reader-question-answer">
        <p><strong>{q.question}</strong></p>
        {q.status === "done" ? <div className="reader-answer" role="status">{renderAnswerMarkdown(q.answer ?? "")}</div>
          : <p role={q.status === "error" ? "alert" : "status"}>{q.status === "error" ? q.error : "Waiting for Opus 5.5…"}</p>}
        {draft && (posted.includes(q.id) ? <p role="status">Posted.</p>
          : <DraftSuggestion draft={draft} posting={poster.posting} onUse={() => void use(q.id, draft)} onEdit={() => onDraft(draft)} />)}
      </div>;
    })}
    <form onSubmit={(event) => { event.preventDefault(); void ask(text.trim()).then((sent) => { if (sent) setText(""); }); }}>
      <Textarea autoGrow aria-label="Question about this passage" placeholder="Ask about this passage, or ask for a note, a forecast or a key point." maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} rows={3} />
      <div className="reader-form-actions"><Button disabled={!!waiting || !text.trim()} type="submit">Ask</Button></div>
    </form>
    {(error || poster.error || questions.isError) && <p role="alert">{error || poster.error || "Your questions couldn't load."}</p>}
    {login}{poster.login}
  </section>;
}

export function ReaderHighlightForm({ item, anchor, kind: initialKind, draft, onClose, onPosted }: {
  item: PageItem; anchor: ReaderAnchor; kind: HighlightDraft["kind"]; draft?: HighlightDraft; onClose: () => void; onPosted: () => void;
}) {
  const { session } = useSession();
  const [kind, setKind] = useState(initialKind);
  const [signed, setSigned] = useState(false);
  const [statement, setStatement] = useState(draft?.statement ?? "");
  const [probability, setProbability] = useState(draft?.kind === "forecast" ? String(draft.probability) : "");
  const [answer, setAnswer] = useState<PassageQuestion | null>(null);
  const agent = usePassageQuestions(item, anchor.paragraph, setAnswer);
  const poster = useHighlightPost(item);
  const suggestion = parseHighlightDraft(answer?.draft);
  const current = parseHighlightDraft({ kind, probability: kind === "forecast" && probability.trim() ? Number(probability) : null, statement });
  async function post(highlight: HighlightDraft, authorName: string | null) {
    if (await poster.post(anchor, highlight, authorName)) onPosted();
  }
  function edit(next: HighlightDraft) {
    setKind(next.kind);
    setStatement(next.statement);
    setProbability(next.kind === "forecast" ? String(next.probability) : "");
    setAnswer(null);
  }
  return <Modal title={kind === "forecast" ? "Forecast" : "Key point"} onClose={onClose} widthClassName="max-w-[35rem]">
    <blockquote>“{anchor.text}”</blockquote>
    <form className="reader-highlight-form" onSubmit={(event) => { event.preventDefault(); if (current) void post(current, signed && session ? displayName(session) : null); }}>
      <label className="reader-highlight-lead" htmlFor="reader-highlight-statement">
        {kind === "forecast" ? <>This is a forecast of a <Input aria-label="Probability (%)" type="number" inputMode="numeric" min={0} max={100} step={1} required placeholder="N" className="reader-highlight-probability" value={probability} onChange={(event) => setProbability(event.target.value)} />% chance of</> : "A key point in this article is"}
      </label>
      <Textarea autoGrow id="reader-highlight-statement" aria-label={kind === "forecast" ? "Forecast statement" : "Key point"} placeholder={kind === "forecast" ? "what the article expects to happen" : "the point, in a sentence"} required maxLength={2000} rows={2} value={statement} onChange={(event) => setStatement(event.target.value)} />
      {session && !session.user.is_anonymous && <Checkbox checked={signed} onChange={setSigned}>Post as {displayName(session)}</Checkbox>}
      {suggestion ? <DraftSuggestion draft={suggestion} posting={poster.posting} onUse={() => void post(suggestion, null)} onEdit={() => edit(suggestion)} />
        : answer?.status === "done" && <div className="reader-answer reader-draft-card" role="status">{renderAnswerMarkdown(answer.answer ?? "")}</div>}
      <div className="reader-form-actions">
        <Button variant="secondary" disabled={!!agent.waiting} onClick={() => { setAnswer(null); void agent.ask(`Draft a ${kind === "forecast" ? "forecast with an integer probability from 0 to 100" : "key point"} about these highlighted words: ${anchor.text.slice(0, 1500)}`); }}>{agent.waiting ? "Drafting…" : "Draft with Opus 5.5"}</Button>
        <span className="reader-form-spacer" />
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={poster.posting || !current}>Post</Button>
      </div>
    </form>
    {(poster.error || agent.error) && <p role="alert">{poster.error || agent.error}</p>}
    {agent.login}{poster.login}
  </Modal>;
}

export function ReaderHighlights({ highlights, onChanged }: { highlights: PassageHighlight[]; onChanged: () => void }) {
  const { session } = useSession();
  const [login, setLogin] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const votes = useQuery({ queryKey: ["highlightVotes", session?.user.id, highlights.map((h) => h.id)], queryFn: () => fetchHighlightVotes(highlights.map((h) => h.id)), enabled: !!session });
  async function change(action: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError("");
    try { await action(); await votes.refetch(); onChanged(); }
    catch { setError("That didn't save. Please try again."); }
    finally { setPending(false); }
  }
  return <>{highlights.map((highlight) => <section className="reader-highlight-card" key={highlight.id}>
    <p>{highlightSentence(highlight)}</p>
    <p className="reader-highlight-author">{highlight.author_name || "Anonymous reader"}</p>
    <p className="text-sm font-semibold text-fg">{ratingQuestion(highlight.kind === "forecast" ? "forecast" : "key point")}</p>
    <VoteRatings helpful={highlight.helpful_count} somewhatHelpful={highlight.somewhat_helpful_count} notHelpful={highlight.not_helpful_count} myVote={votes.data?.get(highlight.id)} onVote={(vote) => void change(async () => {
      const user = await ensureUser();
      if (!user) { setLogin(true); return; }
      await voteOnHighlight(highlight.id, user.id, votes.data?.get(highlight.id) === vote ? null : vote);
    })} />
    {session?.user.id === highlight.author_id && <Button variant="quiet" disabled={pending} onClick={() => void change(() => deletePassageHighlight(highlight.id))}>Delete</Button>}
  </section>)}{error && <p role="alert">{error}</p>}<LoginModal open={login} onClose={() => setLogin(false)} /></>;
}
