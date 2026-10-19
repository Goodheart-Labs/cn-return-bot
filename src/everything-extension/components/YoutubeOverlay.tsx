import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { browser } from "#imports";
import { Quote } from "@cn/ui/typography";
import { useSession } from "@cn/features/auth/useSession";
import { claimGroups, itemNoteSetQuery, type ClaimGroup } from "../utils/claimGroups";
import { listenForDismissingClicks } from "../utils/inertClick";
import { setJumpHandler } from "../utils/jumpBus";
import { NextNoteButton } from "@cn/features/notes/NextNoteButton";
import { PlayIcon } from "@cn/ui/icons";
import { ClaimNoteStack, NOTE_POPOVER_WIDTH } from "./ClaimNoteStack";
import { OverlayLoginGate } from "./OverlayLoginGate";
import { FloatingWindow, type Box } from "./FloatingWindow";
import { useNoteDisplay } from "./NoteDisplayChoices";
import { ScrubberPins } from "./ScrubberPins";

/** A claim pinned to a span of the video timeline, together with its notes and
 *  its note-not-needed entries. This is the same shape the Substack popover
 *  renders. */
export type TimedGroup = ClaimGroup & { startSeconds: number; endSeconds: number };

// A claim without end_seconds stays up this long past its start.
const DEFAULT_CLIP_SECONDS = 30;

/** The claims that carry a timestamp, in timeline order. */
export function timedGroups(groups: ClaimGroup[]): TimedGroup[] {
  return groups
    .flatMap((group) => {
      const start = group.claim.start_seconds;
      if (start == null) return [];
      return [{ ...group, startSeconds: start, endSeconds: group.claim.end_seconds ?? start + DEFAULT_CLIP_SECONDS }];
    })
    .sort((a, b) => a.startSeconds - b.startSeconds);
}
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
// How far from the player's right edge a fresh card sits.
const PLAYER_EDGE_INSET_PX = 16;

function quotePreview(group: TimedGroup): string | null {
  const quote = group.claim.context_quote;
  if (!quote) return null;
  return quote.length > QUOTE_PREVIEW_CHARS ? `${quote.slice(0, QUOTE_PREVIEW_CHARS)}…` : quote;
}

/** Moves the playback position. The overlay only ever seeks through this. */
function seek(video: HTMLVideoElement, seconds: number) {
  video.currentTime = seconds;
}

/** Whether a claim's card appears by itself while playback is inside its part
 *  of the video. On a video, Open and Collapsed both pop up, because a video
 *  has no text beside it where a collapsed card could wait. Dot only leaves
 *  just the pin on the scrub bar, which is the default for unhelpful notes. */
function popsUpDuringPlayback(group: TimedGroup): boolean {
  return group.display === "open" || group.display === "collapse";
}

/** Whether playback at `seconds` is inside the claim's part of the video. */
function playheadInClaim(group: TimedGroup, seconds: number): boolean {
  return seconds >= group.startSeconds && seconds <= group.endSeconds + TRAILING_GRACE_SECONDS;
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** A time in the video as YouTube writes it, such as 4:05 or 1:02:03. */
function formatVideoTime(totalSeconds: number): string {
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / SECONDS_PER_HOUR);
  const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = String(whole % SECONDS_PER_MINUTE).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** The top bar's button that moves the video to the claim, labelled with the
 *  claim's start time. */
function PlayFromButton({ seconds, onPlay }: { seconds: number; onPlay: () => void }) {
  const time = formatVideoTime(seconds);
  return (
    <button
      type="button"
      onClick={onPlay}
      title={`Play the video from ${time}`}
      aria-label={`Play the video from ${time}`}
      className="inline-flex h-6 items-center gap-0.5 rounded-control px-1.5 text-sm tabular-nums text-fg-muted hover:bg-surface-hover hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <PlayIcon size={14} aria-hidden />
      {time}
    </button>
  );
}

/** The player's box in page coordinates, kept current while the player
 *  changes size, which theater mode, fullscreen and window resizing all do.
 *  A fresh card is placed relative to this box. */
function usePlayerBox(player: HTMLElement) {
  const [box, setBox] = useState(() => player.getBoundingClientRect());
  useEffect(() => {
    const update = () => setBox(player.getBoundingClientRect());
    const observer = new ResizeObserver(update);
    observer.observe(player);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [player]);
  return { right: box.right + window.scrollX, centreY: box.top + box.height / 2 + window.scrollY };
}

/** A community note shown over the YouTube player when the video reaches the
 *  claim. The card is the same width as the Substack popover and starts at
 *  the player's right edge, vertically centered. From there it can be
 *  dragged anywhere on the page and resized, like a desktop window, and the
 *  next note on the same video opens where the reader left it. A card that
 *  popped up during playback fades out as soon as playback leaves the claim's
 *  span. It stays up while the pointer is on it and the reader is
 *  mid-interaction. Pins on the scrub bar mark every claim. Clicking one opens
 *  that claim's card without moving the video, and double-clicking one moves
 *  the video to the claim. */
export function YoutubeOverlayApp({ itemId, projectSlug, video, player }: {
  itemId: string;
  projectSlug: string | null;
  video: HTMLVideoElement;
  player: HTMLElement;
}) {
  // The content script fetched the notes before mounting this, so the cache
  // already holds them. A vote, a new note or a changed display choice flows
  // through here.
  const noteSet = useQuery(itemNoteSetQuery(itemId)).data;
  const [display] = useNoteDisplay();
  const groups = useMemo(
    () => (noteSet && display ? timedGroups(claimGroups(noteSet, display)) : []),
    [noteSet, display],
  );
  const { session } = useSession();
  const [loginOpen, setLoginOpen] = useState(false);
  // `displayed` is the claim whose card is mounted. `visible` drives the
  // opacity transition. Hiding happens in two steps. Setting `visible` to
  // false starts the fade, and a timer unmounts the card after FADE_MS.
  const [displayed, setDisplayed] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  // A hidden claim, whether hidden by the card's dismiss button or by a click
  // on empty page surface. Hiding only lasts while playback stays inside the
  // claim's window: leave the passage and come back, and the note shows
  // again. Nothing removes a note for the rest of the video.
  const hushed = useRef<string | null>(null);
  // Only an open or collapsed claim's card pops up on its own during playback.
  // A claim set to dot only shows its card while playback is inside its window
  // only after the reader asked for it, and that request lasts while playback
  // stays inside the claim's window.
  const summoned = useRef<string | null>(null);
  // The claim the reader opened while playback was somewhere else, with its
  // pin, the note count or the popup. Its card stays up wherever playback
  // goes, until the reader closes it. Once playback reaches the claim, it
  // becomes a summoned claim and fades out normally when playback moves on.
  const pinned = useRef<string | null>(null);
  // Whether playback is inside the displayed claim's window. The top bar
  // offers to move the video there only while it is not.
  const [playheadAtClaim, setPlayheadAtClaim] = useState(false);
  const hovered = useRef(false);
  // Whether the card has a reason to stay up apart from the reader's engagement:
  // playback is inside its window, or the reader opened it.
  const cardWanted = useRef(false);
  const lastInteraction = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    pinned.current = null;
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
  useEffect(() => {
    loginOpenRef.current = loginOpen && !session;
  }, [loginOpen, session]);
  const engaged = () => hovered.current || loginOpenRef.current || Date.now() - lastInteraction.current < HOLD_AFTER_INTERACTION_MS;

  useEffect(() => {
    const onTime = () => {
      const t = video.currentTime;
      const inClaimWindow = (g: TimedGroup) => playheadInClaim(g, t);
      const pinnedGroup = groups.find((g) => g.claimId === pinned.current);
      if (pinnedGroup && inClaimWindow(pinnedGroup)) {
        summoned.current = pinned.current;
        pinned.current = null;
      }
      const summonedGroup = groups.find((g) => g.claimId === summoned.current);
      if (summonedGroup && !inClaimWindow(summonedGroup)) summoned.current = null;
      // The claim the reader asked for wins over a claim that pops up on its
      // own, because two claims' windows can overlap.
      const hit =
        groups.find((g) => g.claimId === pinned.current) ??
        groups.find((g) => g.claimId === summoned.current) ??
        groups.find((g) => inClaimWindow(g) && popsUpDuringPlayback(g));
      cardWanted.current = !!hit;
      setPlayheadAtClaim(!!hit && inClaimWindow(hit));
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

  /** Closes the claim's card. If playback is inside the claim's window, the
   *  hush keeps the card down until playback leaves it. */
  const hide = (claimId: string) => {
    hushed.current = claimId;
    beginHide();
  };
  const dismiss = () => {
    if (group) hide(group.claimId);
    else beginHide();
  };
  // A click on empty surface outside the card hushes it too. A plain
  // beginHide would not be enough, because the next timeupdate inside the
  // window would show the card again; the hush holds it down until playback
  // leaves the window. Clicks that actually do something keep the card up,
  // such as clicking the video to play or pause it, or the like button, or
  // the comments. listenForDismissingClicks tells the two apart.
  useEffect(() => {
    if (!group) return;
    return listenForDismissingClicks(() => {
      hushed.current = group.claimId;
      beginHide();
    });
  }, [group]);
  // Opening a claim is explicit intent, so we undo any hiding and show its
  // card at once, without moving the video. The card shows straight away
  // because a paused video sends no timeupdate.
  const openClaim = useCallback((target: TimedGroup) => {
    if (hushed.current === target.claimId) hushed.current = null;
    const atClaim = playheadInClaim(target, video.currentTime);
    if (atClaim) summoned.current = target.claimId;
    else pinned.current = target.claimId;
    cardWanted.current = true;
    setPlayheadAtClaim(atClaim);
    show(target.claimId);
  }, [video]);
  // Moves the video into the claim's window and keeps its card up. From
  // there the card follows playback like any summoned card.
  const playFromClaim = useCallback((target: TimedGroup) => {
    if (hushed.current === target.claimId) hushed.current = null;
    pinned.current = null;
    summoned.current = target.claimId;
    seek(video, target.startSeconds + 0.01);
    cardWanted.current = true;
    setPlayheadAtClaim(true);
    show(target.claimId);
  }, [video]);
  // A click on a pin opens its card, and a second click on the pin of the
  // card on screen closes it again. The second click of a double click moves
  // the video to the claim instead, so a double click opens the card and
  // plays from the claim. The browser counts the clicks in a row as the click
  // event's `detail`.
  const onPinClick = (target: TimedGroup, clicksInARow: number) => {
    if (clicksInARow >= 2) playFromClaim(target);
    else if (shown.current === "visible" && displayed === target.claimId) hide(target.claimId);
    else openClaim(target);
  };

  // The popup's jump button, the request progress card and the note count on
  // the card bring the player on screen and step through the claims
  // in time order, wrapping around at the end. Each step opens the claim's
  // card without moving the video, the same as clicking its pin. A jump goes to the claim after the one on screen, or, with no
  // card up, to the claim after the last one a jump reached. That cursor lives
  // here so that "next" keeps its place when the popup is closed and reopened.
  // It resets when the page reloads.
  const jumpCursor = useRef(-1);
  const scrollToPlayer = useRef(false);
  const displayedIndex = groups.findIndex((g) => g.claimId === displayed);
  const jumpNext = useCallback(() => {
    if (!groups.length) return;
    const from = displayedIndex >= 0 ? displayedIndex : jumpCursor.current;
    jumpCursor.current = (from + 1) % groups.length;
    scrollToPlayer.current = true;
    openClaim(groups[jumpCursor.current]!);
  }, [groups, displayedIndex, openClaim]);
  // The scroll to the player runs once the jumped-to card is on screen.
  // React restores the page's scroll positions while it updates the page, and
  // that cancels a smooth scroll started before the update.
  useEffect(() => {
    if (!scrollToPlayer.current || !displayed) return;
    scrollToPlayer.current = false;
    video.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [displayed, video]);
  useEffect(() => {
    const listener = (message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
      const type = (message as { type?: string })?.type;
      if (type === "cn-jump-state") sendResponse({ jumped: jumpCursor.current >= 0 });
      if (type === "cn-jump-note" && groups.length) {
        jumpNext();
        sendResponse({ jumped: true });
      }
    };
    browser.runtime.onMessage.addListener(listener);
    // The request progress card jumps through the same cursor, see utils/jumpBus.ts.
    setJumpHandler(jumpNext);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      setJumpHandler(null);
    };
  }, [groups, jumpNext]);
  const playerBox = usePlayerBox(player);
  // Where the reader last put a card on this video, and how wide they made
  // it. The next note opens there. Its height is not kept: a new card fits
  // its own text, capped at most of the viewport. This state lives as long as
  // the overlay, which is remounted on every video, so the next video starts
  // at the player's right edge again.
  const [placement, setPlacement] = useState<Omit<Box, "height"> | null>(null);

  return (
    <div className="pointer-events-auto text-left">
      <ScrubberPins groups={groups} video={video} player={player} onPinClick={onPinClick} />
      {group && (
        <FloatingWindow
          // A new claim gets a fresh card, which opens where the reader left
          // the previous one on this video.
          key={group.claimId}
          label="Common Note on this part of the video"
          header={
            <>
              <NextNoteButton position={displayedIndex + 1} total={groups.length} onNext={jumpNext} />
              {!playheadAtClaim && <PlayFromButton seconds={group.startSeconds} onPlay={() => playFromClaim(group)} />}
            </>
          }
          dismissLabel="Dismiss for this video"
          onDismiss={dismiss}
          onPlaced={({ left, top, width }) => setPlacement({ left, top, width })}
          restingStyle={placement ?? { left: playerBox.right - PLAYER_EDGE_INSET_PX, top: playerBox.centreY, width: NOTE_POPOVER_WIDTH, transform: "translate(-100%, -50%)" }}
          // Clicks on the card must not reach the page's own handlers. They
          // are retargeted to the shadow host element, so the page would read
          // them as clicks on empty surface.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          // These run in the capture phase, so the stopPropagation calls above
          // and on the cards inside cannot keep them from firing. A press
          // starting a drag or a resize counts as an interaction too.
          onClickCapture={() => { lastInteraction.current = Date.now(); }}
          onPointerDownCapture={() => { lastInteraction.current = Date.now(); }}
          onKeyDownCapture={() => { lastInteraction.current = Date.now(); }}
          onMouseEnter={() => { hovered.current = true; }}
          onMouseLeave={() => {
            hovered.current = false;
            if (!cardWanted.current && !engaged()) beginHide();
          }}
          className={`transition-opacity duration-[400ms] ease-out ${visible ? "opacity-100" : "opacity-0"}`}
        >
          <OverlayLoginGate open={loginOpen} onOpenChange={setLoginOpen}>
            {quotePreview(group) && (
              <Quote className="mb-4">“{quotePreview(group)}”</Quote>
            )}
            <ClaimNoteStack group={group} projectSlug={projectSlug} />
          </OverlayLoginGate>
        </FloatingWindow>
      )}
    </div>
  );
}
