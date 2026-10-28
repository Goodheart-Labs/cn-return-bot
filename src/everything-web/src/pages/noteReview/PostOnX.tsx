import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewDraft } from "@cn/core/claudeReview";
import { COMMONNOTES_ORIGIN } from "@cn/core/pageUrls";
import { setXMark } from "@cn/core/xMarks";
import { Button } from "@cn/ui/Button";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Textarea } from "@cn/ui/Field";
import { routeHref } from "../../lib/routing";
import { refreshDrafts, type ReviewView } from "./reviewQueries";
import { EXTENSION_REPLY, MISSING_HANDLE, tweetText } from "./tweetText";
import { fetchNoteImage, sendTweet, type TweetTiming } from "./tweetServer";

const TIMINGS: { value: TweetTiming; label: string }[] = [
  { value: "next_free_slot", label: "Next free slot" },
  { value: "now", label: "Post at once" },
];

/** The note's link on commonnotes.net, also when the tool runs locally. */
const publicNoteLink = (draft: ReviewDraft) =>
  COMMONNOTES_ORIGIN + routeHref({ view: "notes", project: draft.post.creatorSlug, item: null, note: draft.noteId });

/** The local posting tool's panel on a card: the proposed tweet and its reply,
 *  both editable, and a picture of the note's card that goes with the tweet.
 *  Sending creates a Typefully draft, which Typefully publishes in the next
 *  free slot of the account's posting queue or at once, and marks the note as
 *  posted on X. Typefully cannot delete a draft through its API, so a mistake
 *  is removed in the Typefully app. */
export function PostOnX({ draft, view, onClose }: { draft: ReviewDraft; view: ReviewView; onClose: () => void }) {
  const client = useQueryClient();
  const [text, setText] = useState(() => tweetText(draft, publicNoteLink(draft)));
  const [reply, setReply] = useState(EXTENSION_REPLY);
  const [timing, setTiming] = useState<TweetTiming>("next_free_slot");
  const noteId = draft.noteId!;
  const image = useQuery({ queryKey: queryKeys.noteImageUrl(noteId), queryFn: () => fetchNoteImage(noteId), staleTime: Infinity });
  const send = useMutation({
    mutationFn: async () => setXMark(noteId, "posted", await sendTweet({ noteId, text, reply, timing })),
    onSuccess: async () => {
      onClose();
      await refreshDrafts(client, view.request, [draft.id]);
    },
  });
  const missingHandle = text.includes(MISSING_HANDLE);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-3 border-t border-line pt-4 text-sm">
      <h3 className="font-medium text-fg">Post on X</h3>
      {image.isError ? (
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
        <Button type="submit" disabled={send.isPending || !image.data || missingHandle || !text.trim()}>
          Send to Typefully
        </Button>
        <Button type="button" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        {send.error && (
          <span role="alert" className="text-negative">
            {send.error.message}
          </span>
        )}
      </div>
    </form>
  );
}
