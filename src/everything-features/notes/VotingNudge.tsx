import { useEffect, useState } from "react";
import { readBrowserFlag, setBrowserFlag } from "@cn/core/extensionStorage";

/** The one-time voting nudge: a small popup above the vote pills of the first
 *  note a reader opens, telling them their rating counts even without any
 *  expertise. It shows once per device and goes away on the first vote or on
 *  "Got it". The website and the extension overlays share this component; the
 *  seen flag lives in synced extension storage where that exists and in
 *  localStorage on the website. */

const SEEN_KEY = "cn:votingNudgeSeen";

// Many note cards can be on screen at once. The first one to mount claims the
// nudge for this page load, so the reader never sees it twice at a time.
let claimedThisLoad = false;

export function useVotingNudge(): { show: boolean; dismiss: () => void } {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (claimedThisLoad) return;
    claimedThisLoad = true;
    void readBrowserFlag(SEEN_KEY, "sync").then((seen) => {
      if (!seen) setShow(true);
    });
  }, []);
  return {
    show,
    dismiss: () => {
      setShow(false);
      setBrowserFlag(SEEN_KEY, "sync");
    },
  };
}

/** The popup itself. The parent supplies the anchor: a relatively positioned
 *  wrapper around the vote pills. */
export function VotingNudge({ onDismiss }: { onDismiss: () => void }) {
  return (
    <span className="absolute bottom-full right-0 mb-2.5 z-10 block w-72 max-w-[80vw] rounded-card border border-inverse-line bg-inverse text-on-inverse shadow-floating p-3 text-left">
      <span className="block text-xs font-bold">You don't need to be an expert</span>
      <span className="mt-1 block text-xs leading-snug text-on-inverse-muted">
        Rate whether this note is helpful to you
      </span>
      <button onClick={onDismiss} className="mt-1.5 block ml-auto text-xs font-semibold text-on-inverse-link hover:underline">
        Got it
      </button>
      <span aria-hidden className="absolute -bottom-1.5 right-14 h-3 w-3 rotate-45 border-b border-r border-inverse-line bg-inverse" />
    </span>
  );
}
