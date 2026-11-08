import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewDraft } from "@cn/core/claudeReview";
import { COMMONNOTES_ORIGIN } from "@cn/core/pageUrls";
import { requestXPost, setXMark } from "@cn/core/xMarks";
import { Button } from "@cn/ui/Button";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Textarea } from "@cn/ui/Field";
import { routeHref } from "../../lib/routing";
import { NoteImagePage } from "./NoteImagePage";
import { refreshDrafts, type ReviewView } from "./reviewQueries";
import { EXTENSION_REPLY, MISSING_HANDLE, taggedForX, tweetText } from "./tweetText";
import { fetchNoteImage, sendTweet, TWEET_SERVER, type TweetTiming } from "./tweetServer";

const TIMINGS: { value: TweetTiming; label: string }[] = [
  { value: "next_free_slot", label: "Next free slot" },
  { value: "now", label: "Post at once" },
];

/** The note's link on commonnotes.net, also when the tool runs locally. */
const publicNoteLink = (draft: ReviewDraft) =>
  taggedForX(COMMONNOTES_ORIGIN + routeHref({ view: "notes", project: draft.post.creatorSlug, item: null, note: draft.noteId }), draft.noteId!);

/** Sends the tweet. In the local posting tool its server makes the Typefully
 *  draft and the browser marks the note as scheduled. On commonnotes.net
 *  there is no such server: the posting worker on the team's server
 *  (src/note-tweets/worker.ts, migration 173) takes the request, always in
 *  the next free slot, and marks the note itself. */
async function send(noteId: string, text: string, reply: string, timing: TweetTiming): Promise<void> {
  if (TWEET_SERVER) return setXMark(noteId, "scheduled", await sendTweet({ noteId, text, reply, timing }));
  const outcome = await requestXPost(noteId, text, reply);
  if (outcome.status === "failed") throw new Error(outcome.error);
  if (outcome.status === "waiting") throw new Error("The server has not answered in two minutes. Reload later: the card shows Scheduled on X once it is done.");
}

/** The Post on X panel on a card: the proposed tweet and its reply, both
 *  editable, and the note's card that goes with the tweet as a picture.
 *  Sending creates a Typefully draft, which Typefully publishes in the next
 *  free slot of the account's posting queue (or, in the local tool, at once),
 *  and marks the note as scheduled on X until Typefully has published it. A
 *  mistake is removed in the Typefully app, and the note then counts as not
 *  posted again. */
export function PostOnX({ draft, view, onClose }: { draft: ReviewDraft; view: ReviewView; onClose: () => void }) {
  const client = useQueryClient();
  const [text, setText] = useState(() => tweetText(draft, publicNoteLink(draft)));
  const [reply, setReply] = useState(EXTENSION_REPLY);
  const [timing, setTiming] = useState<TweetTiming>("next_free_slot");
  const noteId = draft.noteId!;
  const image = useQuery({ queryKey: queryKeys.noteImageUrl(noteId), queryFn: () => fetchNoteImage(noteId), staleTime: Infinity, enabled: !!TWEET_SERVER });
  const sending = useMutation({
    mutationFn: () => send(noteId, text, reply, timing),
    onSuccess: async () => {
      onClose();
      await refreshDrafts(client, view.request, [draft.id]);
    },
  });
  const missingHandle = text.includes(MISSING_HANDLE);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    sending.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-3 border-t border-line pt-4 text-sm">
      <h3 className="font-medium text-fg">Post on X</h3>
      {!TWEET_SERVER ? (
        <div className="overflow-x-auto rounded-control border border-line">
          <NoteImagePage noteId={noteId} />
        </div>
      ) : image.isError ? (
        <p className="text-negative">The picture of the note failed: {image.error.message}</p>
      ) : image.data ? (
        <img src={image.data} alt="The note's card as the tweet shows it" className="w-full rounded-control border border-line" />
      ) : (
        <p className="text-fg-muted">Taking a picture of the note…</p>
      )}
      <Textarea className="w-full" rows={8} value={text} onChange={(e) => setText(e.currentTarget.value)} aria-label="The tweet" />
      <p className={missingHandle ? "text-negative" : "text-xs text-fg-muted"}>
        {missingHandle ? `Replace ${MISSING_HANDLE} with the creator's X handle.` : `${text.length} characters`}
      </p>
      <Textarea className="w-full" rows={4} value={reply} onChange={(e) => setReply(e.currentTarget.value)} aria-label="The reply under the tweet. Leave it empty for none." />
      <div className="flex flex-wrap items-center gap-2">
        {TWEET_SERVER && (
          <>
            <label htmlFor={`timing-${draft.id}`}>Publish</label>
            <select
              id={`timing-${draft.id}`}
              className="rounded-control border border-line-input bg-surface px-2 py-1.5 text-sm text-fg"
              value={timing}
              onChange={(e) => setTiming(e.currentTarget.value as TweetTiming)}
            >
              {TIMINGS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </>
        )}
        <Button type="submit" disabled={sending.isPending || (!!TWEET_SERVER && !image.data) || missingHandle || !text.trim()}>
          {TWEET_SERVER ? "Send to Typefully" : sending.isPending ? "Scheduling…" : "Schedule in the next free slot"}
        </Button>
        <Button type="button" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        {sending.error && (
          <span role="alert" className="text-negative">
            {sending.error.message}
          </span>
        )}
      </div>
    </form>
  );
}
