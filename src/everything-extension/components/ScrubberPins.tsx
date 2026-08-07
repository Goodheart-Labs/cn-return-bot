import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isPageDark, observePageTheme } from "../utils/pageTheme";
import { GROUP_GLYPH_PATH } from "./ClaimNoteStack";
import type { TimedGroup } from "./YoutubeOverlay";

// Map-pin markers on YouTube's scrub bar, one per timestamped claim. They live
// in the HOST page's DOM (inside .ytp-progress-bar), not our shadow root:
// that inherits the control bar's own show/hide fade, and percentage `left`
// positions track every bar size (window resize, theater, fullscreen) with no
// measuring. Styling is a small injected stylesheet — Tailwind stays in the
// shadow root and can't reach these.

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

// The Substack passage badge in pin form: the head is the badge, the tail's
// tip points at the timestamp. Both palettes mirror the badge's (Tailwind
// can't reach the host DOM, hence inline colors), and the pin follows the
// same isPageDark/observePageTheme pair the note card's `.dark` toggle uses
// — one theme source for every YouTube surface.
const PIN_LIGHT = { body: "#ffffff", border: "#d1d5db", glyph: "#2563eb" }; // white / gray-300 / blue-600
const PIN_DARK = { body: "#111827", border: "#4b5563", glyph: "#3b82f6" }; // gray-900 / gray-600 / blue-500

/** Badge-in-pin-form marker: circle head tapering into a tail whose tip is
 *  the bottom-center of the viewBox — the tip is what points at the
 *  timestamp. Head center (12, 10.8), the glyph is scaled into it. */
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
  return preview ? `Community note: “${preview}”` : "Community note — click to jump there";
}

/** Pins portal into a zero-height strip appended inside `.ytp-progress-bar`
 *  (in-flow, so percentage widths resolve against the bar no matter how it's
 *  positioned). A MutationObserver re-attaches the strip when YouTube rebuilds
 *  its control DOM. Clicking a pin seeks the video to the claim's start. */
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
      if (!stripRef.current?.isConnected) attach(); // no-op guard: our own append also fires this
    });
    observer.observe(player, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      stripRef.current?.remove();
      stripRef.current = null;
    };
  }, [player]);

  // duration is NaN until metadata arrives; percentages wait for it.
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
        aria-label="Community note — jump to this moment"
        onClick={(e) => {
          // Keep the click off the bar underneath — a leaked mousedown would
          // start a scrub-drag to wherever the pointer sits.
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
