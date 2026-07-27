import { useEffect, useRef, useState } from "react";
import type { NnnApi } from "../../everything-web/src/components/NoteNotNeeded";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import { ABSORB_KEYS, ClaimNoteStack, NOTE_POPOVER_WIDTH, SignInHint } from "./ClaimNoteStack";
import { ScrubberPins } from "./ScrubberPins";
import { useNoteVoting, replaceNoteInGroup } from "./useNoteVoting";

/** A claim pinned to a span of the video timeline, with its notes and
 *  note-not-needed entries (same shape the Substack popover renders). */
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
// Opacity transition length; the card unmounts when the fade completes.
const FADE_MS = 400;
// A fresh interaction (vote click, typing in a composer) holds the card past
// its window — long enough to outlive the donation notice's own 6.5s
// dwell-and-fade, so post-vote feedback is never ripped away with the clip.
const HOLD_AFTER_INTERACTION_MS = 10_000;

const QUOTE_PREVIEW_CHARS = 160;

function quotePreview(group: TimedGroup): string | null {
  const quote = group.primary.claim?.context_quote;
  if (!quote) return null;
  return quote.length > QUOTE_PREVIEW_CHARS ? `${quote.slice(0, QUOTE_PREVIEW_CHARS)}…` : quote;
}

/** Timestamp-triggered community note over the YouTube player: the full note
 *  card (Substack-sized, right edge, vertically centered) shown only while the
 *  video plays through the claim's span — it fades out the moment playback
 *  leaves the window, unless the pointer is on the card mid-interaction.
 *  Scrub-bar pins mark every claim and seek into its window on click. */
export function YoutubeOverlayApp({ groups: initialGroups, projectSlug, video, player, refetch }: {
  groups: TimedGroup[];
  projectSlug: string | null;
  video: HTMLVideoElement;
  player: HTMLElement;
  /** Re-fetch the item's groups (no realtime here) after a post or delete. */
  refetch: () => Promise<TimedGroup[]>;
}) {
  const [groups, setGroups] = useState(initialGroups);
  // displayed = which claim's card is mounted; visible = drives the opacity
  // transition. Hiding is two-step: visible=false starts the fade, the timer
  // unmounts after FADE_MS.
  const [displayed, setDisplayed] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const dismissed = useRef(new Set<string>()); // per-video-session
  const hovered = useRef(false);
  const inWindow = useRef(false);
  const lastInteraction = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { session, myVotes, myNnnVotes, handleVote, handleNnnVote, recordAuthored, recordNnnAuthored, onNeedLogin, signInHint, dismissSignInHint } = useNoteVoting(
    (updated) => setGroups((prev) => prev.map((g) => replaceNoteInGroup(g, updated))),
    (updatedEntry) => setGroups((prev) => prev.map((g) => ({
      ...g,
      nnn: g.nnn.map((e) => (e.id === updatedEntry.id ? updatedEntry : e)),
    }))),
  );

  // `shown` mirrors displayed/hiding for the event handlers (timeupdate fires
  // ~4×/s — reading state through a closure would go stale, and re-arming the
  // unmount timer on every tick would keep an invisible card mounted forever,
  // shielding the player from clicks). beginHide is idempotent: the first call
  // starts the fade, later calls while it runs are no-ops.
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

  // The card outlives its window only while the reader is engaged with it:
  // pointer on the card, or an interaction (click/keystroke) fresher than the
  // hold. The playing video's timeupdate stream re-evaluates as holds expire;
  // on a paused video the card simply stays — paused means reading.
  const engaged = () => hovered.current || Date.now() - lastInteraction.current < HOLD_AFTER_INTERACTION_MS;

  useEffect(() => {
    const onTime = () => {
      const t = video.currentTime;
      const hit = groups.find((g) => !dismissed.current.has(g.claimId) && t >= g.startSeconds && t <= g.endSeconds);
      inWindow.current = !!hit;
      if (hit) show(hit.claimId);
      // The moment playback leaves the window the card fades — unless the
      // reader is engaged (mid-vote, mid-donation-pick, mid-composition).
      else if (!engaged()) beginHide();
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
  // A pin click is explicit intent: un-dismiss and seek into the window — the
  // resulting timeupdate shows the card.
  const jumpToPin = (target: TimedGroup) => {
    dismissed.current.delete(target.claimId);
    video.currentTime = target.startSeconds + 0.01;
  };

  // The popup's "n notes on this page" link: bring the player on screen and
  // jump to the first claim, same as clicking its pin.
  useEffect(() => {
    const listener = (message: unknown) => {
      if ((message as { type?: string })?.type === "cn-scroll-to-notes" && groups[0]) {
        video.scrollIntoView({ behavior: "smooth", block: "center" });
        jumpToPin(groups[0]);
      }
    };
    const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
    runtime?.onMessage.addListener(listener);
    return () => runtime?.onMessage.removeListener(listener);
  }, [groups, video]);
  const refresh = async () => setGroups(await refetch());
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
          // Clicks on the card must not fall through to the player's own
          // handlers either (retargeted to the host element, they look like
          // player-chrome clicks to YouTube).
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          // Capture phase so ABSORB_KEYS' stopPropagation can't starve them.
          onClickCapture={() => { lastInteraction.current = Date.now(); }}
          onKeyDownCapture={() => { lastInteraction.current = Date.now(); }}
          onMouseEnter={() => { hovered.current = true; }}
          onMouseLeave={() => {
            hovered.current = false;
            if (!inWindow.current && !engaged()) beginHide();
          }}
          style={{ width: NOTE_POPOVER_WIDTH }}
          className={`max-w-[85vw] max-h-[70vh] overflow-y-auto overscroll-contain bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xl p-3 transition-opacity duration-[400ms] ease-out ${visible ? "opacity-100" : "opacity-0"}`}
        >
          {signInHint && <SignInHint onDismiss={dismissSignInHint} className="mb-2" />}
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
