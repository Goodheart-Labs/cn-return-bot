import { useEffect, useRef, useState } from "react";
import { CHARITIES, setDonationCharity, usePreferredCharity, type CharityId } from "../lib/donations";
import type { DonationPair } from "../lib/donationScoring";

const charityLabel = (id: CharityId) => CHARITIES.find((c) => c.id === id)!.label;

/** The charity name inline in the donation copy — clickable, opening a small
 *  popover to redirect the donation to one of the other charities. */
function CharityPicker({ charity, onPick }: { charity: CharityId; onPick: (c: CharityId) => void }) {
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen((o) => !o)}
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
 *  inline. Donation only — discussion lives in the note's action row
 *  (Jim, 2026-07-17: separate widgets). */
export function VoteDonation({ voteId, pair, onClose }: {
  voteId: string;
  pair: DonationPair;
  onClose: () => void;
}) {
  const [charity, setCharityPref] = usePreferredCharity();

  // The donation row already exists (minted with the vote); a pick updates it
  // and becomes the remembered default for future votes.
  const pickCharity = (c: CharityId) => {
    setCharityPref(c);
    void setDonationCharity(voteId, c);
  };

  return (
    // Theme note: only unmodified utility classes (bg-blue-50, not bg-blue-50/50)
    // — design.css remaps the exact class names per color scheme.
    <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-3 flex items-start justify-between gap-3">
      <p className="text-sm text-gray-700">
        We will donate <strong>${pair.ifHelpful.toFixed(2)}</strong> to{" "}
        <CharityPicker charity={charity} onPick={pickCharity} /> if this note ends up rated{" "}
        <span className="font-medium text-green-700">helpful</span> and{" "}
        <strong>${pair.ifNotHelpful.toFixed(2)}</strong> if it ends up rated{" "}
        <span className="font-medium text-red-600">unhelpful</span>.
      </p>
      <button onClick={onClose} className="text-sm text-gray-500 hover:underline shrink-0">Close</button>
    </div>
  );
}
