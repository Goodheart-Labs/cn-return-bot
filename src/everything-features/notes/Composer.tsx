import type { Session } from "@supabase/supabase-js";
import { displayName } from "@cn/core/session";
import { Button } from "@cn/ui/Button";
import { Checkbox, Textarea } from "@cn/ui/Field";
import { createLocalPreference } from "../hooks/createLocalPreference";

/** A note or an argument shorter than this is almost certainly unfinished, so
 *  the post button stays disabled until the text is longer. */
const MIN_TEXT_LENGTH = 10;

/** The database refuses a reader's note or argument longer than this
 *  (migration 114), so the text area stops there. */
const MAX_TEXT_LENGTH = 2000;

/** Bylines are opt-in, so posting is anonymous by default, the way X's own
 *  Community Notes work. Nathan made this change on 2026-07-14, because note
 *  writing is adversarial work and attaching a name without being asked was a
 *  consent gap. Jim made the choice persist on 2026-07-17. Tick the box once
 *  and every later composer opens with it ticked. Untick it and they open
 *  unticked. */
const useSignedByline = createLocalPreference<boolean>("cn-signed-byline", {
  parse: (raw) => raw === "1",
  serialize: (signed) => (signed ? "1" : "0"),
});

/** The one place a reader writes: an improved note, an argument that a claim
 *  needs no note, or a new note on a passage they selected. The text lives
 *  with the caller, so a draft survives the composer being hidden and shown
 *  again. `onSubmit` receives whether the reader chose to sign it. */
export function Composer({ session, text, onTextChange, placeholder, rows, submitLabel, onSubmit, onCancel, pending, error }: {
  session: Session;
  text: string;
  onTextChange: (text: string) => void;
  placeholder: string;
  rows: number;
  submitLabel: string;
  onSubmit: (signed: boolean) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const [signed, setSigned] = useSignedByline();
  return (
    <div className="mt-2 space-y-2">
      <Textarea autoGrow value={text} onChange={(e) => onTextChange(e.target.value)} rows={rows} maxLength={MAX_TEXT_LENGTH} autoFocus placeholder={placeholder} />
      <div className="flex gap-2 items-center">
        <Button onClick={() => onSubmit(signed)} disabled={pending || text.trim().length < MIN_TEXT_LENGTH}>
          {pending ? "Posting…" : submitLabel}
        </Button>
        <Button variant="quiet" className="text-sm" onClick={onCancel}>Cancel</Button>
        <Checkbox checked={signed} onChange={setSigned} className="ml-auto text-xs text-fg-muted">
          Post as {displayName(session)}
        </Checkbox>
      </div>
      {error && <p className="text-sm text-negative">{error}</p>}
    </div>
  );
}
