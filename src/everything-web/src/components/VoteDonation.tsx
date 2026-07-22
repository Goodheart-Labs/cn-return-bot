import { useEffect, useRef, useState } from "react";
import { CHARITIES, setDonationCharity, usePreferredCharity, type CharityId } from "../lib/donations";
import type { DonationPair } from "../lib/donationScoring";
import type { NoteStatus } from "../../../everything-shared/noteScore";

const charityLabel = (id: CharityId) => CHARITIES.find((c) => c.id === id)!.label;

/** How long the notice sits fully visible before fading itself out, and how
 *  long the fade takes. Anything that shows the reader is still using the box —
 *  hovering it, or having the charity popover open — restarts the dwell, so the
 *  donation can always be redirected without racing the fade. */
const DWELL_MS = 5000;
const FADE_MS = 1500;

/** The charity name inline in the donation copy — clickable, opening a small
 *  popover to redirect the donation to one of the other charities. Open state
 *  lives in the parent, which holds the notice open while the popover is. */
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
        className="text-blue-600 font-medium hover:underline"
        title="Choose a different charity"
      >
        {charityLabel(charity)}
      </button>
      {open && (
        <div className="cn-menu absolute left-0 top-6 z-20 w-72 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5 text-sm">
          {CHARITIES.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onPick(c.id);
                setOpen(false);
              }}
              aria-pressed={c.id === charity}
              className={`flex w-full items-center text-left px-2.5 py-2 rounded-lg font-medium hover:bg-gray-100 ${
                c.id === charity ? "text-blue-600" : "text-gray-700"
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

/** The donation notice shown right after casting a note vote: the
 *  outcome-contingent pair frozen at vote time, with the charity switchable
 *  inline. Dismisses itself once the reader is done with it. Donation only —
 *  discussion lives in the note's action row (Jim, 2026-07-17: separate
 *  widgets). */
export function VoteDonation({ voteId, pair, charity, status, onCharityChange, onClose }: {
  voteId: string;
  pair: DonationPair;
  /** The charity the ledger row currently holds — the display never guesses. */
  charity: CharityId;
  status: NoteStatus;
  onCharityChange: (charity: CharityId) => void;
  onClose: () => void;
}) {
  const [, setCharityPref] = usePreferredCharity();
  const [failed, setFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [fading, setFading] = useState(false);
  const inUse = pickerOpen || hovered || failed;

  // Fade out and unmount once the reader is no longer using the box; any use
  // cancels a fade in progress and restarts the dwell from scratch.
  useEffect(() => {
    if (inUse) return setFading(false);
    const fade = setTimeout(() => setFading(true), DWELL_MS);
    const close = setTimeout(onClose, DWELL_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(close);
    };
  }, [inUse]);

  // The donation row already exists (minted with the vote); a pick redirects it
  // and becomes the remembered default for future donations. Optimistic, but
  // rolled back unless the ledger verifiably changed — the box must never show
  // a charity the row doesn't hold.
  const pickCharity = async (picked: CharityId) => {
    const previous = charity;
    setCharityPref(picked);
    onCharityChange(picked);
    setFailed(false);
    if (!(await setDonationCharity(voteId, picked))) {
      onCharityChange(previous);
      setFailed(true);
    }
  };

  return (
    // Theme note: only unmodified utility classes (bg-blue-50, not bg-blue-50/50)
    // — design.css remaps the exact class names per color scheme.
    <div
      className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-3 flex items-start justify-between gap-3"
      style={{ opacity: fading ? 0 : 1, transition: `opacity ${FADE_MS}ms ease` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="min-w-0">
        {status === "needs_ratings" ? (
          <p className="text-sm text-gray-700">
            We will donate <strong>${pair.ifHelpful.toFixed(2)}</strong> to{" "}
            <CharityPicker charity={charity} onPick={pickCharity} open={pickerOpen} setOpen={setPickerOpen} /> if this note ends up rated{" "}
            <span className="font-medium text-green-700">helpful</span> and{" "}
            <strong>${pair.ifNotHelpful.toFixed(2)}</strong> if it ends up rated{" "}
            <span className="font-medium text-red-600">unhelpful</span>.
          </p>
        ) : (
          <p className="text-sm text-gray-700">
            This note is rated{" "}
            {status === "helpful" ? (
              <span className="font-medium text-green-700">helpful</span>
            ) : (
              <span className="font-medium text-red-600">unhelpful</span>
            )}
            , so we will donate{" "}
            <strong>${(status === "helpful" ? pair.ifHelpful : pair.ifNotHelpful).toFixed(2)}</strong> to{" "}
            <CharityPicker charity={charity} onPick={pickCharity} open={pickerOpen} setOpen={setPickerOpen} />.
          </p>
        )}
        {failed && <p className="text-sm text-red-600 mt-1">Could not switch the charity — try again.</p>}
      </div>
      <button onClick={onClose} className="text-sm text-gray-500 hover:underline shrink-0">Close</button>
    </div>
  );
}
