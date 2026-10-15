import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isWholePageChecked, type PageItem } from "@cn/core/items";
import { submitNoteRequest } from "@cn/core/noteRequests";
import { progressIsTerminal, progressLines, type RequestProgress } from "@cn/core/requestProgress";
import { watchRequestProgress, type RequestWatch } from "@cn/core/requestProgressController";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Card } from "@cn/ui/Card";
import { useReader, type ReaderModule, type ReaderNoteRequest } from "../context";
import { ClosedEntry, EntryBar } from "../EntryBar";

export const requestCardId = (scope: string, requestId: string) => `${scope}-request-${requestId}`;

export function useNoteRequests(item: PageItem, notify: (message: string) => void) {
  const client = useQueryClient();
  const [requests, setRequests] = useState<readonly ReaderNoteRequest[]>([]);
  const live = useRef({ closed: false, nextId: 0, byQuote: new Map<string, Pick<ReaderNoteRequest, "id" | "blockId">>(), watches: new Set<RequestWatch>() });

  useEffect(() => {
    const state = live.current;
    state.closed = false;
    return () => {
      state.closed = true;
      for (const watch of state.watches) watch.stop();
      state.watches.clear();
    };
  }, []);

  const setProgress = (id: string, progress: RequestProgress) =>
    setRequests((current) => current.map((request) => (request.id === id ? { ...request, progress } : request)));

  async function send(id: string, quote: string) {
    const state = live.current;
    let token: string;
    try {
      token = await submitNoteRequest({ pageUrl: item.url, pageTitle: item.title ?? "", selection: quote });
    } catch {
      state.byQuote.delete(quote);
      setRequests((current) => current.filter((request) => request.id !== id));
      notify("Your request did not send. Please try again.");
      return;
    }
    if (state.closed) return;
    state.watches.add(watchRequestProgress({
      token,
      onProgress: (progress) => {
        setProgress(id, progress);
        if (progressIsTerminal(progress)) void client.invalidateQueries({ queryKey: queryKeys.itemNoteSet(item.id) });
      },
    }));
  }

  function request(blockId: string, quote: string): Pick<ReaderNoteRequest, "id" | "blockId"> {
    const state = live.current;
    // The request carries only the words, so the same words in another passage are the same request.
    const existing = state.byQuote.get(quote);
    if (existing) return existing;
    const id = String(state.nextId++);
    state.byQuote.set(quote, { id, blockId });
    setRequests((current) => [...current, { id, blockId, quote, progress: { kind: "saved" } }]);
    void send(id, quote);
    return { id, blockId };
  }

  return { requests, request };
}

function RequestCard({ request }: { request: ReaderNoteRequest }) {
  const { scope, isCollapsed } = useReader();
  const id = requestCardId(scope, request.id);
  const lines = progressLines(request.progress);
  if (isCollapsed(id)) return <ClosedEntry elementId={id} kind="Note request" detail={lines.join(", ")} />;
  return <section id={id} className="reader-entry" aria-label="Note request">
    <Card className="min-w-0 p-4">
      <div className="-mt-1 mb-3 flex items-center"><EntryBar elementId={id} kind="note request" /></div>
      <p className="reader-entry-kind">Note request</p>
      <p className="reader-ask-quote">“{request.quote}”</p>
      <div role="status" className="reader-ask-status">{lines.map((line) => <p key={line}>{line}</p>)}</div>
    </Card>
  </section>;
}

function RequestEntries({ blockId }: { blockId: string }) {
  const { noteRequests } = useReader();
  return <>{noteRequests.filter((request) => request.blockId === blockId).map((request) => <RequestCard key={request.id} request={request} />)}</>;
}

export const requestNoteModule: ReaderModule = {
  name: "requestNote",
  // Before the article's own check, a request would replace the minisite's text with a fresh fetch of the page.
  selectionActions: (api, block, quote) => (isWholePageChecked(api.item) ? [{
    feature: "highlight.request",
    key: "request",
    label: "Request note",
    accessibleName: "Request note on these words",
    onSelect: () => {
      const request = api.requestNote(block.id, quote);
      const cardId = requestCardId(api.scope, request.id);
      document.getSelection()?.removeAllRanges();
      api.setCollapsed(cardId, false);
      api.reveal(cardId, request.blockId);
    },
  }] : []),
  marginCount: (api, blockId) => api.noteRequests.filter((request) => request.blockId === blockId).length,
  MarginEntries: RequestEntries,
};
