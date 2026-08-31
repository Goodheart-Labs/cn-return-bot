import { useEffect, useState } from "react";

/** The one-time voting nudge: a small popup above the vote pills of the first
 *  note a reader opens, telling them their rating counts even without any
 *  expertise. It shows once per device and goes away on the first vote or on
 *  "Got it". The website and the extension overlays share this component; the
 *  seen flag lives in synced extension storage where that exists and in
 *  localStorage on the website. */

const SEEN_KEY = "cn:votingNudgeSeen";

function extensionSyncStorage(): { get: (key: string) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void> } | null {
  const g = globalThis as { browser?: any; chrome?: any };
  return g.browser?.storage?.sync ?? g.chrome?.storage?.sync ?? null;
}

async function getNudgeSeen(): Promise<boolean> {
  const ext = extensionSyncStorage();
  if (ext) return !!(await ext.get(SEEN_KEY))[SEEN_KEY];
  try {
    return localStorage.getItem(SEEN_KEY) === "true";
  } catch {
    // A browser that blocks storage sees the nudge on every load, which beats
    // never showing it.
    return false;
  }
}

function markNudgeSeen(): void {
  const ext = extensionSyncStorage();
  if (ext) {
    void ext.set({ [SEEN_KEY]: true });
    return;
  }
  try {
    localStorage.setItem(SEEN_KEY, "true");
  } catch {
    // Nothing to do; the flag just cannot persist here.
  }
}

// Many note cards can be on screen at once. The first one to mount claims the
// nudge for this page load, so the reader never sees it twice at a time.
let claimedThisLoad = false;

export function useVotingNudge(): { show: boolean; dismiss: () => void } {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (claimedThisLoad) return;
    claimedThisLoad = true;
    void getNudgeSeen().then((seen) => {
      if (!seen) setShow(true);
    });
  }, []);
  return {
    show,
    dismiss: () => {
      setShow(false);
      markNudgeSeen();
    },
  };
}

/** The popup itself. The parent supplies the anchor: a relatively positioned
 *  wrapper around the vote pills. */
export function VotingNudge({ onDismiss }: { onDismiss: () => void }) {
  return (
    <span className="absolute bottom-full right-0 mb-2.5 z-10 block w-72 max-w-[80vw] rounded-xl bg-gray-900 text-gray-50 shadow-xl dark:bg-gray-800 dark:border dark:border-gray-600 p-3 text-left">
      <span className="block text-[13px] font-bold">You don't need to be an expert</span>
      <span className="mt-1 block text-[13px] leading-snug text-gray-300">
        Rate whether this note is helpful to you. Ratings are what decide if a note shows.
      </span>
      <button onClick={onDismiss} className="mt-1.5 block ml-auto text-xs font-semibold text-blue-300 hover:underline">
        Got it
      </button>
      <span aria-hidden className="absolute -bottom-1.5 right-14 h-3 w-3 rotate-45 bg-gray-900 dark:bg-gray-800 dark:border-b dark:border-r dark:border-gray-600" />
    </span>
  );
}
