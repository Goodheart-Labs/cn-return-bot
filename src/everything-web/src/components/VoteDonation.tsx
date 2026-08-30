import { useEffect, useRef, useState } from "react";
import { MENU } from "../../../everything-shared/ui";
import { CHARITIES, rememberCharity, setDonationCharity, type CharityId } from "../lib/donations";
import type { DonationPair } from "../lib/donationScoring";
import type { NoteStatus } from "../../../everything-shared/noteScore";

const charityLabel = (id: CharityId) => CHARITIES.find((c) => c.id === id)!.label;

/** How long the notice stays fully visible before it starts to fade, and how
 *  long the fade itself takes (both in milliseconds). Any sign that the reader
 *  is still using the box restarts the wait. Hovering it counts, and so does
 *  having the charity popover open. That way the donation can always be
 *  redirected without racing the fade. */
const DWELL_MS = 5000;
const FADE_MS = 1500;

/** The charity name shown inline in the donation text. Clicking it opens a
 *  small popover for redirecting the donation to one of the other charities.
 *  The open state lives in the parent, because the parent keeps the notice on
 *  screen for as long as the popover is open. */
function CharityPicker({ charity, onPick, open, setOpen }: {
  charity: CharityId;
  onPick: (c: CharityId) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <span ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
        title="Choose a different charity"
      >
        {charityLabel(charity)}
      </button>
      {open && (
        <div className={`absolute left-0 top-6 z-20 ${MENU} w-72`}>
          {CHARITIES.map((c) => (
            <button
              key={c.id}
              // The browser scrolls a newly focused element into view, and that
              // is what reveals a menu opening below the fold of the popover.
              autoFocus={c.id === charity}
              onClick={() => {
                onPick(c.id);
                setOpen(false);
              }}
              aria-pressed={c.id === charity}
              className={`flex w-full items-center text-left px-2 py-2 rounded-lg font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                c.id === charity ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-300"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** The donation notice shown right after you vote on a note. It states the two
 *  amounts frozen at vote time, one for each way the note can settle, and it
 *  lets you switch the charity inline. It dismisses itself once you are done
 *  with it. It covers the donation and nothing else. Jim split the two apart on
 *  2026-07-17, so discussion is its own action in the note's action row. */
export function VoteDonation({ voteId, pair, charity, status, onCharityChange, onClose }: {
  voteId: string;
  pair: DonationPair;
  /** The charity the ledger row currently holds. The box never guesses it. */
  charity: CharityId;
  status: NoteStatus;
  onCharityChange: (charity: CharityId) => void;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [fading, setFading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inUse = pickerOpen || hovered || failed;

  /* The notice mounts at the bottom of whatever holds the note. Inside the
   * extension's scrolling popovers that spot can be below the fold, and a
   * notice nobody sees defeats its purpose. Scrolling to "nearest" does nothing
   * when the box is already visible. */
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  // Fade the box out and unmount it once the reader stops using it. Any use
  // cancels a fade already running and starts the wait again from zero.
  useEffect(() => {
    if (inUse) return setFading(false);
    const fade = setTimeout(() => setFading(true), DWELL_MS);
    const close = setTimeout(onClose, DWELL_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(close);
    };
  }, [inUse]);

  /* The donation row was already written when the vote was cast. Picking a
   * charity redirects that row, and the pick also becomes the remembered
   * default for future donations. The display updates first, and it is rolled
   * back unless the ledger really changed. The box must never show a charity
   * the row does not hold. */
  const pickCharity = async (picked: CharityId) => {
    const previous = charity;
    rememberCharity(picked);
    onCharityChange(picked);
    setFailed(false);
    if (!(await setDonationCharity(voteId, picked))) {
      onCharityChange(previous);
      setFailed(true);
    }
  };

  return (
    <div
      ref={boxRef}
      className="mt-2 rounded-lg border border-blue-200 bg-blue-100 dark:border-blue-800 dark:bg-blue-900/40 p-3 flex items-start justify-between gap-3"
      style={{ opacity: fading ? 0 : 1, transition: `opacity ${FADE_MS}ms ease` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="min-w-0">
        {status === "needs_ratings" ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            We will donate <strong>${pair.ifHelpful.toFixed(2)}</strong> to{" "}
            <CharityPicker charity={charity} onPick={pickCharity} open={pickerOpen} setOpen={setPickerOpen} /> if this note ends up rated{" "}
            <span className="font-medium text-green-700 dark:text-green-400">helpful</span> and{" "}
            <strong>${pair.ifNotHelpful.toFixed(2)}</strong> if it ends up rated{" "}
            <span className="font-medium text-red-600 dark:text-red-400">unhelpful</span>.
          </p>
        ) : (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            This note is rated{" "}
            {status === "helpful" ? (
              <span className="font-medium text-green-700 dark:text-green-400">helpful</span>
            ) : (
              <span className="font-medium text-red-600 dark:text-red-400">unhelpful</span>
            )}
            , so we will donate{" "}
            <strong>${(status === "helpful" ? pair.ifHelpful : pair.ifNotHelpful).toFixed(2)}</strong> to{" "}
            <CharityPicker charity={charity} onPick={pickCharity} open={pickerOpen} setOpen={setPickerOpen} />.
          </p>
        )}
        {failed && <p className="text-sm text-red-600 dark:text-red-400 mt-1">Could not switch the charity (try again)</p>}
      </div>
      <button onClick={onClose} className="text-sm text-gray-500 dark:text-gray-400 hover:underline shrink-0">Close</button>
    </div>
  );
}
