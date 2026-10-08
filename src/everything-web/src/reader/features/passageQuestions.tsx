import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureUser } from "@cn/core/auth";
import type { PageItem } from "@cn/core/items";
import { highlightSentence, type HighlightDraft, type PassageQuestion } from "@cn/core/passageHighlights";
import { askPassageQuestion, fetchPassageQuestions, postPassageHighlight, subscribeToPassages } from "@cn/core/passages";
import { useSession } from "@cn/features/auth/useSession";
import { Button } from "@cn/ui/Button";
import { LoginModal } from "../../components/LoginModal";
import type { ReaderAnchor } from "../context";

/** How often an unanswered question is checked, in case the realtime update
 *  is missed. */
const ANSWER_POLL_MS = 5000;

const isWaiting = (question: PassageQuestion) => question.status === "pending" || question.status === "answering";

/** The reader's questions to Opus about one passage, and asking a new one.
 *  `onAnswered` runs once for each question this hook sent, when it is answered. */
export function usePassageQuestions(item: PageItem, passage: string, onAnswered?: (question: PassageQuestion) => void) {
  const { session } = useSession();
  const client = useQueryClient();
  const [login, setLogin] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const waitingFor = useRef<string | null>(null);
  const questions = useQuery({
    queryKey: ["passageQuestions", item.id, passage, session?.user.id],
    queryFn: () => fetchPassageQuestions(item.id, passage, session!.user.id),
    enabled: !!session,
    refetchInterval: (query) => (waitingFor.current || query.state.data?.some(isWaiting) ? ANSWER_POLL_MS : false),
  });
  useEffect(() => subscribeToPassages(item.id, () => { void client.invalidateQueries({ queryKey: ["passageQuestions", item.id] }); }), [item.id, client]);
  useEffect(() => {
    const question = questions.data?.find((q) => q.id === waitingFor.current);
    if (!question || isWaiting(question)) return;
    waitingFor.current = null;
    if (question.status === "error") setError(question.error ?? "Opus could not answer. Please try again.");
    onAnswered?.(question);
  }, [questions.data, onAnswered]);

  async function ask(text: string): Promise<boolean> {
    setSending(true);
    setError("");
    try {
      const user = await ensureUser();
      if (!user) { setLogin(true); return false; }
      waitingFor.current = await askPassageQuestion(item.id, passage, text, user.id);
      await client.invalidateQueries({ queryKey: ["passageQuestions", item.id] });
      return true;
    } catch {
      setError("Your question did not send. Please try again.");
      return false;
    } finally {
      setSending(false);
    }
  }
  const waiting = sending || !!questions.data?.some(isWaiting);
  return { questions, ask, waiting, error, login: <LoginModal open={login} onClose={() => setLogin(false)} /> };
}

/** Posting a key point or a forecast. */
export function useHighlightPost(item: PageItem) {
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  async function post(anchor: Pick<ReaderAnchor, "text" | "paragraph">, highlight: HighlightDraft, authorName: string | null = null): Promise<boolean> {
    setPosting(true);
    setError("");
    try {
      const user = await ensureUser();
      if (!user) { setLogin(true); return false; }
      await postPassageHighlight({
        item_id: item.id, kind: highlight.kind, quote: anchor.text, context_paragraph: anchor.paragraph,
        statement: highlight.statement.trim(), probability: highlight.kind === "forecast" ? highlight.probability : null,
        author_id: user.id, author_name: authorName,
      });
      return true;
    } catch {
      setError(`Your ${highlight.kind === "forecast" ? "forecast" : "key point"} did not post. Please try again.`);
      return false;
    } finally {
      setPosting(false);
    }
  }
  return { post, posting, error, login: <LoginModal open={login} onClose={() => setLogin(false)} /> };
}

/** A draft Opus wrote, as a card the reader can post as it is or edit. */
export function DraftSuggestion({ draft, posting, onUse, onEdit }: { draft: HighlightDraft; posting: boolean; onUse: () => void; onEdit: () => void }) {
  return <div className="reader-draft-card">
    <p className="reader-entry-kind">Suggested {draft.kind === "forecast" ? "forecast" : "key point"}</p>
    <p>{highlightSentence(draft)}</p>
    <div className="reader-draft-actions">
      <Button variant="secondary" onClick={onEdit}>Edit</Button>
      <Button disabled={posting} onClick={onUse}>Use this draft</Button>
    </div>
  </div>;
}
