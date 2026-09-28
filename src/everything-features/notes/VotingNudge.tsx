import { useEffect, useState } from "react";
import { readBrowserFlag, setBrowserFlag } from "@cn/core/extensionStorage";
import { RATING_QUESTION } from "./NoteBox";

/** The one-time voting nudge: on the first note a reader opens, the rating
 *  panel's question also tells them their rating counts even without any
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

/** The hint itself. It takes the place of the question in the note's rating
 *  panel, so it never covers the note it asks the reader to rate, and a
 *  screen reader reads it as part of the panel. */
export function VotingNudge({ onDismiss }: { onDismiss: () => void }) {
  return (
    <span>
      <span className="font-semibold">{RATING_QUESTION}</span> <span className="text-fg-secondary">You don't need to be an expert.</span>{" "}
      <button type="button" onClick={onDismiss} className="font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-control">
        Got it
      </button>
    </span>
  );
}
