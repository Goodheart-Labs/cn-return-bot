import { useEffect, useRef, useState } from "react";
import type { NnnApi } from "../../everything-web/src/components/NoteNotNeeded";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import { insideCommonNotesUi, isInertClick } from "../utils/inertClick";
import { setJumpHandler } from "../utils/jumpBus";
import { onNoteFiltersChanged } from "../utils/settings";
import { ABSORB_KEYS, ClaimNoteStack, NOTE_POPOVER_WIDTH, OverlayLogin } from "./ClaimNoteStack";
import { ScrubberPins } from "./ScrubberPins";
import { useNoteVoting, replaceNoteInGroup } from "./useNoteVoting";

/** A claim pinned to a span of the video timeline, together with its notes and
 *  its note-not-needed entries. This is the same shape the Substack popover
 *  renders. */
export interface TimedGroup {
  claimId: string;
  primary: NoteRow;
  alternatives: NoteRow[];
  nnn: NnnRow[];
  startSeconds: number;
  endSeconds: number;
}

// A claim without end_seconds stays up this long past its start.
export const DEFAULT_CLIP_SECONDS = 30;
// The card outlives its span by this much, so a note about a sentence someone
// just said is still there when the reader looks up.
const TRAILING_GRACE_SECONDS = 1;
// How long the opacity transition runs. The card unmounts once the fade
// completes.
const FADE_MS = 400;
// A fresh interaction holds the card open past the claim's window. A vote
// click or typing in a composer both count as one. The hold outlasts the 6.5
// seconds the donation notice takes to dwell and fade, so post-vote feedback
// is never taken away together with the clip.
const HOLD_AFTER_INTERACTION_MS = 10_000;

const QUOTE_PREVIEW_CHARS = 160;

function quotePreview(group: TimedGroup): string | null {
  const quote = group.primary.claim?.context_quote;
  if (!quote) return null;
  return quote.length > QUOTE_PREVIEW_CHARS ? `${quote.slice(0, QUOTE_PREVIEW_CHARS)}…` : quote;
}

/** A community note shown over the YouTube player when the video reaches the
 *  claim. The card is the same size as the Substack popover and sits at the
 *  right edge, vertically centered. It only shows while playback is inside the
 *  claim's span, and it fades out as soon as playback leaves that span. It
 *  stays up while the pointer is on it and the reader is mid-interaction.
 *  Pins on the scrub bar mark every claim, and clicking one seeks into that
 *  claim's span. */
export function YoutubeOverlayApp({ groups: initialGroups, projectSlug, video, player, refetch }: {
  groups: TimedGroup[];
  projectSlug: string | null;
  video: HTMLVideoElement;
  player: HTMLElement;
  /** Re-fetch the item's groups after a note is posted or deleted. There is no
   *  realtime subscription here. */
  refetch: () => Promise<TimedGroup[]>;
}) {
  const [groups, setGroups] = useState(initialGroups);
  // `displayed` is the claim whose card is mounted. `visible` drives the
  // opacity transition. Hiding happens in two steps. Setting `visible` to
  // false starts the fade, and a timer unmounts the card after FADE_MS.
  const [displayed, setDisplayed] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  // The claims the reader dismissed with the card's own dismiss button. This
  // set is dropped when the page moves on to another video.
  const dismissed = useRef(new Set<string>());
  // A claim hidden by a click on empty page surface. Unlike a dismissal it
  // only lasts while playback stays inside the claim's window, so a stray
  // click cannot remove a note for the rest of the video.
  const hushed = useRef<string | null>(null);
  const hovered = useRef(false);
  const inWindow = useRef(false);
  const lastInteraction = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { session, myVotes, myNnnVotes, handleVote, handleNnnVote, recordAuthored, recordNnnAuthored, onNeedLogin, loginOpen, closeLogin } = useNoteVoting(
    (updated) => setGroups((prev) => prev.map((g) => replaceNoteInGroup(g, updated))),
    (updatedEntry) => setGroups((prev) => prev.map((g) => ({
      ...g,
      nnn: g.nnn.map((e) => (e.id === updatedEntry.id ? updatedEntry : e)),
    }))),
  );

  // `shown` mirrors the displayed and hiding state for the event handlers.
  // The timeupdate event fires about four times a second, and reading React
  // state through a closure there would go stale. Re-arming the unmount timer
  // on every tick would also keep an invisible card mounted forever, which
  // would shield the player from clicks. So beginHide is idempotent. The first
  // call starts the fade, and later calls while it runs do nothing.
  const shown = useRef<"visible" | "hiding" | "none">("none");
  const show = (claimId: string) => {
    clearTimeout(hideTimer.current);
    shown.current = "visible";
    setDisplayed(claimId);
    setVisible(true);
  };
  const beginHide = () => {
    if (shown.current !== "visible") return;
    shown.current = "hiding";
    setVisible(false);
    hideTimer.current = setTimeout(() => {
      shown.current = "none";
      setDisplayed(null);
    }, FADE_MS);
  };

  // The card outlives its window only while the reader is engaged with it.
  // That means the pointer is on the card, there was a click or keystroke more
  // recently than the hold allows, or the login form is open. The login hold
  // matters because fetching the emailed code means leaving this tab while the
  // video plays on; the card must still be there on return. A playing video
  // re-evaluates this on every timeupdate, so the card goes once the hold
  // expires. On a paused video the card simply stays, because a paused video
  // means someone is reading.
  const loginOpenRef = useRef(false);
  loginOpenRef.current = loginOpen && !session;
  const engaged = () => hovered.current || loginOpenRef.current || Date.now() - lastInteraction.current < HOLD_AFTER_INTERACTION_MS;

  useEffect(() => {
    const onTime = () => {
      const t = video.currentTime;
      const hit = groups.find(
        (g) => !dismissed.current.has(g.claimId) && t >= g.startSeconds && t <= g.endSeconds + TRAILING_GRACE_SECONDS,
      );
      inWindow.current = !!hit;
      // A claim hushed by an outside click stays hidden while playback is
      // still inside its window. Once the window is left, the hush ends, so
      // seeking back into the claim shows its card again.
      if (hushed.current && hushed.current !== hit?.claimId) hushed.current = null;
      if (hit && hit.claimId !== hushed.current) show(hit.claimId);
      // The card fades once playback leaves the window and its grace. It stays
      // if the reader is engaged, for example mid-vote, picking a charity, or
      // typing a note.
      else if (!hit && !engaged()) beginHide();
    };
    video.addEventListener("timeupdate", onTime);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      clearTimeout(hideTimer.current);
    };
  }, [groups, video]);

  const group = groups.find((g) => g.claimId === displayed);

  const dismiss = () => {
    if (group) dismissed.current.add(group.claimId);
    beginHide();
  };
  // A click on empty surface outside the card hushes it. A plain beginHide
  // would not be enough, because the next timeupdate inside the window would
  // show the card again; the hush holds it down until playback leaves the
  // window. Only the ✕ dismisses a claim for the whole video. Clicks that
  // actually do something keep the card up, such as clicking the video to
  // play or pause it, or the like button, or the comments. isInertClick tells
  // the two apart by looking for the signs that an element is interactive.
  useEffect(() => {
    if (!group) return;
    const onClick = (e: MouseEvent) => {
      if (insideCommonNotesUi(e) || !isInertClick(e)) return;
      if (!window.getSelection()?.isCollapsed) return;
      hushed.current = group.claimId;
      beginHide();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [group]);
  // Clicking a pin is explicit intent, so we undo any dismissal and seek into
  // the claim's window. The resulting timeupdate shows the card.
  const jumpToPin = (target: TimedGroup) => {
    dismissed.current.delete(target.claimId);
    if (hushed.current === target.claimId) hushed.current = null;
    video.currentTime = target.startSeconds + 0.01;
  };

  // The popup's jump button brings the player on screen and steps through the
  // claims in time order, wrapping around at the end. This is the same as
  // clicking their pins. The cursor lives here so that "next" keeps its place
  // when the popup is closed and reopened. It resets when the page reloads.
  const jumpCursor = useRef(-1);
  useEffect(() => {
    const jumpNext = () => {
      if (!groups.length) return;
      jumpCursor.current = (jumpCursor.current + 1) % groups.length;
      video.scrollIntoView({ behavior: "smooth", block: "center" });
      jumpToPin(groups[jumpCursor.current]!);
    };
    const listener = (message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
      const type = (message as { type?: string })?.type;
      if (type === "cn-jump-state") sendResponse({ jumped: jumpCursor.current >= 0 });
      if (type === "cn-jump-note" && groups.length) {
        jumpNext();
        sendResponse({ jumped: true });
      }
    };
    const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
    runtime?.onMessage.addListener(listener);
    // The note-count card jumps through the same cursor, see utils/jumpBus.ts.
    setJumpHandler(jumpNext);
    return () => {
      runtime?.onMessage.removeListener(listener);
      setJumpHandler(null);
    };
  }, [groups, video]);
  const refresh = async () => setGroups(await refetch());
  // Flipping a tickbox in the popup re-fetches the notes through the new
  // filters straight away.
  useEffect(() => onNoteFiltersChanged(() => void refresh()), []);
  const handleAuthored = (noteId: string) => {
    recordAuthored(noteId);
    void refresh();
  };
  const handleNnnAuthored = (entryId: string) => {
    recordNnnAuthored(entryId);
    void refresh();
  };
  const nnnApi: NnnApi = { myVotes: myNnnVotes, onVote: handleNnnVote, onAuthored: recordNnnAuthored, onDeleted: () => void refresh() };

  return (
    <div className="pointer-events-auto text-left">
      <ScrubberPins groups={groups} video={video} player={player} onPinClick={jumpToPin} />
      {group && (
        <div
          {...ABSORB_KEYS}
          // Clicks on the card must not reach the player's own handlers
          // either. They are retargeted to the shadow host element, so
          // YouTube reads them as clicks on the player's own controls.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          // These run in the capture phase. Otherwise the stopPropagation in
          // ABSORB_KEYS would stop them from ever firing.
          onClickCapture={() => { lastInteraction.current = Date.now(); }}
          onKeyDownCapture={() => { lastInteraction.current = Date.now(); }}
          onMouseEnter={() => { hovered.current = true; }}
          onMouseLeave={() => {
            hovered.current = false;
            if (!inWindow.current && !engaged()) beginHide();
          }}
          style={{ width: NOTE_POPOVER_WIDTH }}
          // The select-text class is needed. Inside the shadow root
          // `user-select` resets to `auto`, which resolves to the parent's
          // used value. The parent here is #movie_player, where YouTube sets
          // `none` across the whole player. Without opting back in explicitly
          // the note text could not be copied.
          className={`select-text max-w-[85vw] max-h-[70vh] overflow-y-auto overscroll-contain bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xl p-3 transition-opacity duration-[400ms] ease-out ${visible ? "opacity-100" : "opacity-0"}`}
        >
          {loginOpen && !session && <OverlayLogin onDismiss={closeLogin} />}
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Community note on this part of the video</span>
            <button onClick={dismiss} title="Dismiss for this video" className="px-1.5 shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">✕</button>
          </div>
          {quotePreview(group) && (
            <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-2 mb-2 text-xs text-gray-500 dark:text-gray-400 italic">“{quotePreview(group)}”</blockquote>
          )}
          <ClaimNoteStack
            group={group}
            projectSlug={projectSlug}
            session={session}
            myVotes={myVotes}
            onVote={handleVote}
            onNeedLogin={onNeedLogin}
            onAuthored={handleAuthored}
            onNnnAuthored={handleNnnAuthored}
            onDeleted={() => void refresh()}
            nnnApi={nnnApi}
          />
        </div>
      )}
    </div>
  );
}
