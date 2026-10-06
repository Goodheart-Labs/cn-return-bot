import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureUser } from "@cn/core/auth";
import { highlightSentence, parseHighlightDraft, type HighlightDraft, type PassageHighlight, type PassageQuestion } from "@cn/core/passageHighlights";
import { deletePassageHighlight, fetchHighlightVotes, voteOnHighlight } from "@cn/core/passages";
import { displayName } from "@cn/core/session";
import type { Vote } from "@cn/core/votes";
import { useSession } from "@cn/features/auth/useSession";
import { NextNoteButton } from "@cn/features/notes/NextNoteButton";
import { RatingPanel, ratingQuestion } from "@cn/features/notes/NoteBox";
import { VoteRatings } from "@cn/features/notes/VoteRatings";
import { Button } from "@cn/ui/Button";
import { Checkbox, Input, Textarea } from "@cn/ui/Field";
import { Modal } from "@cn/ui/Modal";
import { LoginModal } from "../../components/LoginModal";
import { useReader, type ReaderAnchor, type ReaderModule } from "../context";
import { DialogFooter, DialogQuote } from "../DialogParts";
import { DraftSuggestion, useHighlightPost, usePassageQuestions } from "./passageQuestions";

/** The longest quote handed to Opus when it drafts from selected words. */
const MAX_DRAFT_QUOTE_CHARS = 1500;

const kindName = (kind: HighlightDraft["kind"]) => (kind === "forecast" ? "forecast" : "key point");

export const highlightCardId = (scope: string, highlightId: string) => `${scope}-highlight-${highlightId}`;

function HighlightDialog({ anchor, initialKind, draft }: { anchor: ReaderAnchor; initialKind: HighlightDraft["kind"]; draft?: HighlightDraft }) {
  const { item, features, closeDialog, refetchHighlights, notify } = useReader();
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
  const canDraft = features.has("opus.drafts");

  async function post(highlight: HighlightDraft, authorName: string | null) {
    if (!(await poster.post(anchor, highlight, authorName))) return;
    closeDialog();
    document.getSelection()?.removeAllRanges();
    refetchHighlights();
    notify(`Your ${kindName(highlight.kind)} is posted. Other readers can now rate it.`);
  }
  function edit(next: HighlightDraft) {
    setKind(next.kind);
    setStatement(next.statement);
    setProbability(next.kind === "forecast" ? String(next.probability) : "");
    setAnswer(null);
  }
  function askForDraft() {
    setAnswer(null);
    const wanted = kind === "forecast" ? "forecast with an integer probability from 0 to 100" : "key point";
    void agent.ask(`Draft a ${wanted} about these highlighted words: ${anchor.text.slice(0, MAX_DRAFT_QUOTE_CHARS)}`);
  }

  return <Modal title={kind === "forecast" ? "Forecast" : "Key point"} onClose={closeDialog} widthClassName="max-w-[35rem]">
    <DialogQuote label="On the words you selected" text={anchor.text} />
    <form className="reader-dialog-form" onSubmit={(event) => { event.preventDefault(); if (current) void post(current, signed && session ? displayName(session) : null); }}>
      <label className="reader-highlight-lead" htmlFor="reader-highlight-statement">
        {kind === "forecast"
          ? <>This is a forecast of a <span className="reader-nowrap"><Input aria-label="Probability in percent" type="number" inputMode="numeric" min={0} max={100} step={1} required placeholder="70" className="reader-highlight-probability" value={probability} onChange={(event) => setProbability(event.target.value)} />% chance of</span></>
          : "A key point in this article is"}
      </label>
      <Textarea autoGrow id="reader-highlight-statement" aria-label={kind === "forecast" ? "What the forecast is about" : "The key point"} placeholder={kind === "forecast" ? "what the article expects to happen" : "the point, in a sentence"} required maxLength={2000} rows={2} value={statement} onChange={(event) => setStatement(event.target.value)} />
      <p className="reader-dialog-hint">Other readers rate whether this {kindName(kind)} is helpful.</p>
      {session && !session.user.is_anonymous && <Checkbox checked={signed} onChange={setSigned}>Post as {displayName(session)}</Checkbox>}
      {suggestion
        ? <DraftSuggestion draft={suggestion} posting={poster.posting} onUse={() => void post(suggestion, null)} onEdit={() => edit(suggestion)} />
        : answer?.status === "done" && <p className="reader-draft-card" role="status">{answer.answer}</p>}
      {(poster.error || agent.error) && <p role="alert" className="reader-dialog-error">{poster.error || agent.error}</p>}
      <DialogFooter helper={canDraft && <Button variant="secondary" disabled={agent.waiting} onClick={askForDraft}>{agent.waiting ? "Drafting…" : "Draft with Opus"}</Button>}>
        <Button variant="quiet" onClick={closeDialog}>Cancel</Button>
        <Button type="submit" disabled={poster.posting || !current}>Post</Button>
      </DialogFooter>
    </form>
    {agent.login}{poster.login}
  </Modal>;
}

function Dialogs() {
  const { dialog } = useReader();
  if (dialog?.kind !== "highlight") return null;
  return <HighlightDialog key={`${dialog.anchor.blockId}-${dialog.highlightKind}`} anchor={dialog.anchor} initialKind={dialog.highlightKind} draft={dialog.draft} />;
}

function HighlightCard({ highlight, myVote, pending, onVote, onDelete }: {
  highlight: PassageHighlight;
  myVote: Vote | undefined;
  pending: boolean;
  onVote: (vote: Vote) => void;
  onDelete: (() => void) | null;
}) {
  const { scope, entryNavigation } = useReader();
  const kind = highlight.kind === "forecast" ? "forecast" : "key point";
  const navigation = entryNavigation(highlightCardId(scope, highlight.id));
  return <section id={highlightCardId(scope, highlight.id)} className="reader-entry reader-highlight-card" aria-label={kind}>
    {navigation && <div className="-mt-1 mb-3 flex items-center"><NextNoteButton {...navigation} /></div>}
    <p className="reader-entry-kind">{kind === "forecast" ? `Forecast · ${highlight.probability}%` : "Key point"}<span>{highlight.author_name || "Anonymous reader"}</span></p>
    <p className="reader-highlight-sentence">{highlightSentence(highlight)}</p>
    <RatingPanel question={<span className="font-semibold">{ratingQuestion(kind)}</span>}>
      <VoteRatings helpful={highlight.helpful_count} somewhatHelpful={highlight.somewhat_helpful_count} notHelpful={highlight.not_helpful_count} myVote={myVote} onVote={onVote} />
    </RatingPanel>
    {onDelete && <Button variant="quiet" className="mt-2 text-xs" disabled={pending} onClick={onDelete}>Delete</Button>}
  </section>;
}

function HighlightEntries({ blockId }: { blockId: string }) {
  const { highlightsByBlock, refetchHighlights } = useReader();
  const { session } = useSession();
  const client = useQueryClient();
  const highlights = highlightsByBlock.get(blockId) ?? [];
  const ids = highlights.map((h) => h.id);
  const [login, setLogin] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const votes = useQuery({ queryKey: ["highlightVotes", session?.user.id, ids], queryFn: () => fetchHighlightVotes(ids), enabled: !!session && ids.length > 0 });
  if (!highlights.length) return null;

  async function change(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["highlightVotes"] });
      refetchHighlights();
    } catch {
      setError("That didn't save. Please try again.");
    } finally {
      setPending(false);
    }
  }
  const vote = (highlight: PassageHighlight, value: Vote) => void change(async () => {
    const user = await ensureUser();
    if (!user) { setLogin(true); return; }
    await voteOnHighlight(highlight.id, user.id, votes.data?.get(highlight.id) === value ? null : value);
  });
  return <>
    {highlights.map((highlight) => <HighlightCard key={highlight.id} highlight={highlight} myVote={votes.data?.get(highlight.id)} pending={pending}
      onVote={(value) => vote(highlight, value)}
      onDelete={session?.user.id === highlight.author_id ? () => void change(() => deletePassageHighlight(highlight.id)) : null} />)}
    {error && <p role="alert" className="reader-dialog-error">{error}</p>}
    <LoginModal open={login} onClose={() => setLogin(false)} />
  </>;
}

/** Readers' forecasts and key points on selected words, rated by others. */
export const highlightsModule: ReaderModule = {
  name: "highlights",
  selectionActions: (api, block, quote) => (["forecast", "key_point"] as const).map((kind) => ({
    feature: kind === "forecast" ? "highlight.forecast" : "highlight.keyPoint",
    key: kind,
    label: kind === "forecast" ? "Forecast" : "Key point",
    accessibleName: kind === "forecast" ? "Add a forecast on these words" : "Add a key point on these words",
    onSelect: () => api.openDialog({ kind: "highlight", highlightKind: kind, anchor: { blockId: block.id, text: quote, paragraph: block.text, partial: true } }),
  })),
  marginCount: (api, blockId) => api.highlightsByBlock.get(blockId)?.length ?? 0,
  MarginEntries: HighlightEntries,
  Dialogs,
};
