import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseHighlightDraft, type HighlightDraft } from "@cn/core/passageHighlights";
import { Button } from "@cn/ui/Button";
import { Textarea } from "@cn/ui/Field";
import { CloseIcon } from "@cn/ui/icons";
import { renderAnswerMarkdown } from "../../lib/readerMarkdown";
import { useReader, type ReaderModule } from "../context";
import { DraftSuggestion, useHighlightPost, usePassageQuestions } from "./passageQuestions";

/** The database refuses a question longer than this. */
const MAX_QUESTION_LENGTH = 2000;

function canUseDraft(features: ReadonlySet<string>, draft: HighlightDraft): boolean {
  return draft.kind === "forecast" ? features.has("highlight.forecast") : features.has("highlight.keyPoint");
}

function AskPanel({ blockId }: { blockId: string }) {
  const { item, blocks, features, asking, closeAsk, openDialog, refetchHighlights } = useReader();
  const block = blocks.find((b) => b.id === blockId)!;
  const quote = asking?.quote ?? null;
  const [text, setText] = useState("");
  const { questions, ask, waiting, error, login } = usePassageQuestions(item, block.text);
  const poster = useHighlightPost(item);
  const client = useQueryClient();
  const [posted, setPosted] = useState<string[]>([]);
  const panel = useRef<HTMLElement>(null);
  const drafts = features.has("opus.drafts");

  useEffect(() => {
    panel.current?.querySelector("textarea")?.focus();
  }, [blockId, quote]);
  // Escape closes the panel while focus is inside it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && panel.current?.contains(document.activeElement)) closeAsk(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeAsk]);

  async function use(questionId: string, draft: HighlightDraft) {
    if (!(await poster.post({ text: block.text, paragraph: block.text }, draft))) return;
    setPosted((ids) => [...ids, questionId]);
    refetchHighlights();
    await client.invalidateQueries({ queryKey: ["passageHighlights", item.id] });
  }
  async function send() {
    // Quoted words go first, so Opus sees which part of the passage is meant.
    const question = quote ? `“${quote.trim()}” ${text.trim()}` : text.trim();
    if (await ask(question)) setText("");
  }

  return <section ref={panel} className="reader-entry reader-ask-panel" aria-label="Ask Opus about this passage">
    <header>
      <h3>Ask Opus</h3>
      <button type="button" className="reader-icon-button" aria-label="Close Ask Opus" onClick={closeAsk}><CloseIcon size={16} aria-hidden /></button>
    </header>
    <p className="reader-ask-intro">
      {features.has("opus.search") ? "Opus answers with sources from the web." : "Opus answers from the article and what it knows."}
      {drafts && " It can also draft a key point or a forecast for you."}
    </p>
    {questions.data?.map((q) => {
      const draft = parseHighlightDraft(q.draft);
      return <div key={q.id} className="reader-ask-exchange">
        <p className="reader-ask-question">{q.question}</p>
        {q.status === "done" ? <div className="reader-answer">{renderAnswerMarkdown(q.answer ?? "")}</div>
          : <p role={q.status === "error" ? "alert" : "status"} className="reader-ask-status">{q.status === "error" ? q.error : "Opus is answering…"}</p>}
        {draft && drafts && canUseDraft(features, draft) && (posted.includes(q.id)
          ? <p role="status" className="reader-ask-status">Posted.</p>
          : <DraftSuggestion draft={draft} posting={poster.posting} onUse={() => void use(q.id, draft)}
              onEdit={() => openDialog({ kind: "highlight", highlightKind: draft.kind, draft, anchor: { blockId: block.id, text: block.text, paragraph: block.text, partial: false } })} />)}
      </div>;
    })}
    <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {quote && <p className="reader-ask-quote"><span>About</span> “{quote}”</p>}
      <Textarea autoGrow aria-label="Your question about this passage" maxLength={MAX_QUESTION_LENGTH} rows={3} value={text} onChange={(event) => setText(event.target.value)}
        placeholder={drafts ? "Ask about this passage, or ask for a key point or a forecast." : "Ask about this passage."} />
      <div className="reader-ask-actions"><Button type="submit" disabled={waiting || !text.trim()}>{waiting ? "Waiting…" : "Ask"}</Button></div>
    </form>
    {(error || poster.error || questions.isError) && <p role="alert" className="reader-dialog-error">{error || poster.error || "Your questions couldn't load."}</p>}
    <p className="reader-ask-smallprint">Answers come from Claude Opus 5.5 and can be wrong.</p>
    {login}{poster.login}
  </section>;
}

function AskEntries({ blockId }: { blockId: string }) {
  const { asking } = useReader();
  return asking?.blockId === blockId ? <AskPanel key={`${blockId}-${asking.quote ?? ""}`} blockId={blockId} /> : null;
}

/** Ask Opus about selected words or about a whole passage. */
export const askOpusModule: ReaderModule = {
  name: "askOpus",
  selectionActions: (api, block, quote) => [{
    feature: "highlight.askOpus",
    key: "ask",
    label: "Ask Opus",
    accessibleName: "Ask Opus about these words",
    onSelect: () => api.openAsk(block, quote),
  }],
  passageActions: (api, block) => [{
    feature: "passage.askOpus",
    key: "ask",
    label: "Ask Opus",
    accessibleName: `Ask Opus about this passage: ${block.text.slice(0, 60)}`,
    onSelect: () => api.openAsk(block, null),
  }],
  marginCount: (api, blockId) => (api.asking?.blockId === blockId ? 1 : 0),
  MarginEntries: AskEntries,
};
