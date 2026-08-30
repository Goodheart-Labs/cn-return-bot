import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isPageDark, observePageTheme } from "../utils/pageTheme";
import { GROUP_GLYPH_PATH } from "./ClaimNoteStack";
import type { TimedGroup } from "./YoutubeOverlay";

// Map-pin markers on YouTube's scrub bar, one for each timestamped claim. They
// live in the host page's DOM, inside .ytp-progress-bar, rather than in our
// shadow root. That way they inherit the control bar's own fade in and out, and
// a `left` position given in percent follows every size the bar takes without us
// measuring anything. Window resizing, theater mode and fullscreen all work. The
// pins are styled by a small injected stylesheet, because Tailwind stays in the
// shadow root and cannot reach the host page.

const PIN_STYLE_ID = "common-notes-pin-style";
const PIN_CSS = `
.cn-scrub-pin {
  position: absolute;
  bottom: 6px;
  transform: translateX(-50%);
  pointer-events: auto;
  cursor: pointer;
  transition: transform .15s ease;
  /* Above YouTube's tall invisible scrub hit-area, which otherwise paints
     over the pin body and eats its clicks — only the tip poking out above
     it was clickable. */
  z-index: 60;
}
.cn-scrub-pin:hover { transform: translateX(-50%) scale(1.2); }
.cn-scrub-pin svg { display: block; width: 18px; height: 24px; filter: drop-shadow(0 1px 1px rgba(0,0,0,.5)); }
.ytp-big-mode .cn-scrub-pin svg { width: 22px; height: 29px; }
`;

function ensurePinStyle() {
  if (document.getElementById(PIN_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PIN_STYLE_ID;
  style.textContent = PIN_CSS;
  document.head.appendChild(style);
}

// The Substack passage badge drawn as a pin. The head of the pin is the badge
// and the tip of its tail points at the timestamp. Both palettes copy the
// badge's colors. They are written out here because Tailwind cannot reach the
// host page's DOM. The pin reads the theme through the same isPageDark and
// observePageTheme pair that drives the note card's `.dark` class, so every
// YouTube surface follows one theme source.
const PIN_LIGHT = { body: "#ffffff", border: "#d1d5db", glyph: "#2563eb" }; // Tailwind white, gray-300, blue-600.
const PIN_DARK = { body: "#111827", border: "#4b5563", glyph: "#3b82f6" }; // Tailwind gray-900, gray-600, blue-500.

/** Draws the marker as a round head that tapers into a tail. The tip of the tail
 *  sits at the bottom centre of the viewBox, and that tip is what points at the
 *  timestamp. The head is centred at (12, 10.8) and the group glyph is scaled to
 *  fit inside it. */
function PinGlyph({ dark }: { dark: boolean }) {
  const palette = dark ? PIN_DARK : PIN_LIGHT;
  return (
    <svg viewBox="0 0 24 32" aria-hidden>
      <path
        d="M12 1C6.5 1 2 5.4 2 10.8 2 18 12 31 12 31s10-13 10-20.2C22 5.4 17.5 1 12 1z"
        fill={palette.body}
        stroke={palette.border}
        strokeWidth="1.5"
      />
      <g transform="translate(4.56 3.36) scale(0.62)">
        <path d={GROUP_GLYPH_PATH} fill={palette.glyph} />
      </g>
    </svg>
  );
}

const PIN_TOOLTIP_CHARS = 120;

function pinTitle(group: TimedGroup): string {
  const quote = group.primary.claim?.context_quote ?? group.primary.claim?.claim ?? "";
  const preview = quote.length > PIN_TOOLTIP_CHARS ? `${quote.slice(0, PIN_TOOLTIP_CHARS)}…` : quote;
  return preview ? `Community note: “${preview}”` : "Click to jump to this community note";
}

/** The pins are portalled into a strip of zero height that we append inside
 *  `.ytp-progress-bar`. The strip stays in the normal flow, so a position given
 *  in percent resolves against the bar however the bar itself is positioned. A
 *  MutationObserver puts the strip back whenever YouTube rebuilds its control
 *  DOM. Clicking a pin seeks the video to the start of that claim. */
export function ScrubberPins({ groups, video, player, onPinClick }: {
  groups: TimedGroup[];
  video: HTMLVideoElement;
  player: HTMLElement;
  onPinClick: (group: TimedGroup) => void;
}) {
  const [strip, setStrip] = useState<HTMLElement | null>(null);
  const stripRef = useRef<HTMLElement | null>(null);
  const [duration, setDuration] = useState(video.duration || 0);
  const [dark, setDark] = useState(() => isPageDark());
  useEffect(() => observePageTheme(setDark), []);

  useEffect(() => {
    ensurePinStyle();
    const attach = () => {
      const bar = player.querySelector(".ytp-progress-bar");
      if (!bar) return;
      let el = bar.querySelector<HTMLElement>(":scope > .cn-scrub-pins");
      if (!el) {
        el = document.createElement("div");
        el.className = "cn-scrub-pins";
        el.style.cssText = "position:relative;width:100%;height:0;pointer-events:none;z-index:60;";
        bar.appendChild(el);
      }
      stripRef.current = el;
      setStrip(el);
    };
    attach();
    const observer = new MutationObserver(() => {
      if (!stripRef.current?.isConnected) attach(); // Our own append fires this observer too.
    });
    observer.observe(player, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      stripRef.current?.remove();
      stripRef.current = null;
    };
  }, [player]);

  // The video's duration is NaN until its metadata has arrived, so the pin
  // percentages have to wait for it.
  useEffect(() => {
    const update = () => setDuration(video.duration || 0);
    video.addEventListener("durationchange", update);
    video.addEventListener("loadedmetadata", update);
    return () => {
      video.removeEventListener("durationchange", update);
      video.removeEventListener("loadedmetadata", update);
    };
  }, [video]);

  if (!strip || !duration) return null;
  return createPortal(
    groups.map((group) => (
      <button
        key={group.claimId}
        className="cn-scrub-pin"
        style={{ left: `${(group.startSeconds / duration) * 100}%`, background: "none", border: "none", padding: 0 }}
        title={pinTitle(group)}
        aria-label="Jump to this community note"
        onClick={(e) => {
          // Keep the click off the bar underneath. A mousedown that leaked
          // through would start a scrub-drag to wherever the pointer sits.
          e.preventDefault();
          e.stopPropagation();
          onPinClick(group);
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <PinGlyph dark={dark} />
      </button>
    )),
    strip,
  );
}
