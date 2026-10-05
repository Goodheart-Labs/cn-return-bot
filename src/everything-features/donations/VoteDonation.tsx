import { useEffect, useRef, useState } from "react";
import { Button } from "@cn/ui/Button";
import { Menu, MenuItem } from "@cn/ui/Menu";
import { useAutoDismiss } from "@cn/ui/useAutoDismiss";
import { useOutsidePress } from "@cn/ui/useOutsidePress";
import { useMutation } from "@tanstack/react-query";
import { CHARITIES, rememberCharity, setDonationCharity, type CharityId } from "@cn/core/donations";
import type { DonationPair } from "@cn/core/donationScoring";
import type { NoteStatus } from "@cn/core/noteScore";

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

  useOutsidePress(ref, open, () => setOpen(false));

  return (
    <span ref={ref} className="relative">
      {/* A plain inline run of text rather than the button's usual inline box,
          so a long charity name wraps like the sentence around it and the
          full stop stays right after it. */}
      <Button variant="link" className="inline text-left font-medium" onClick={() => setOpen(!open)} title="Choose a different charity">
        {charityLabel(charity)}
      </Button>
      {open && (
        <Menu className="absolute left-0 top-6 z-20 w-72">
          {CHARITIES.map((c) => (
            <MenuItem
              key={c.id}
              autoFocus={c.id === charity}
              selected={c.id === charity}
              onClick={() => {
                onPick(c.id);
                setOpen(false);
              }}
            >
              {c.label}
            </MenuItem>
          ))}
        </Menu>
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
  /* The donation row was already written when the vote was cast. Picking a
   * charity redirects that row, and the pick also becomes the remembered
   * default for future donations. The display updates first, and it is rolled
   * back unless the ledger really changed. The box must never show a charity
   * the row does not hold. */
  const redirect = useMutation({
    mutationFn: (picked: CharityId) => setDonationCharity(voteId, picked),
    onMutate: (picked) => {
      rememberCharity(picked);
      onCharityChange(picked);
      return { previous: charity };
    },
    onError: (_err, _picked, context) => context && onCharityChange(context.previous),
  });
  const failed = redirect.isError;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
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
  const { fading } = useAutoDismiss({ dwellMs: DWELL_MS, fadeMs: FADE_MS, paused: inUse, onDismiss: onClose });

  const pickCharity = (picked: CharityId) => redirect.mutate(picked);

  return (
    <div
      ref={boxRef}
      className="mt-2 rounded-control border border-tint-line bg-tint p-3 flex items-start justify-between gap-3"
      style={{ opacity: fading ? 0 : 1, transition: `opacity ${FADE_MS}ms ease` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="min-w-0">
        {status === "needs_ratings" ? (
          <p className="text-sm text-fg-secondary">
            We will donate <strong>${pair.ifHelpful.toFixed(2)}</strong> to{" "}
            <CharityPicker charity={charity} onPick={pickCharity} open={pickerOpen} setOpen={setPickerOpen} /> if this note ends up rated{" "}
            <span className="font-medium text-positive">helpful</span> and{" "}
            <strong>${pair.ifNotHelpful.toFixed(2)}</strong> if it ends up rated{" "}
            <span className="font-medium text-negative">unhelpful</span>.
          </p>
        ) : (
          <p className="text-sm text-fg-secondary">
            This note is rated{" "}
            {status === "helpful" ? (
              <span className="font-medium text-positive">helpful</span>
            ) : (
              <span className="font-medium text-negative">unhelpful</span>
            )}
            , so we will donate{" "}
            <strong>${(status === "helpful" ? pair.ifHelpful : pair.ifNotHelpful).toFixed(2)}</strong> to{" "}
            <CharityPicker charity={charity} onPick={pickCharity} open={pickerOpen} setOpen={setPickerOpen} />.
          </p>
        )}
        {failed && <p className="text-sm text-negative mt-1">Could not switch the charity (try again)</p>}
      </div>
      <Button variant="quiet" className="text-sm shrink-0" onClick={onClose}>Close</Button>
    </div>
  );
}
