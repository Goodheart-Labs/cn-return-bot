import { useState } from "react";
import { MAX_REQUEST_STEER_LENGTH } from "@cn/core/noteRequests";
import { Button } from "@cn/ui/Button";
import { Textarea } from "@cn/ui/Field";

/** The step before a request for a note on selected words is sent. The reader
 *  may say why the words need a note, and the note writer reads that as a
 *  hint. The reason is optional, so an empty box sends too. */
export function RequestReasonForm({ onSend, onCancel }: {
  onSend: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <form className="mt-2 space-y-2" onSubmit={(event) => { event.preventDefault(); onSend(reason); }}>
      <Textarea
        autoGrow
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={MAX_REQUEST_STEER_LENGTH}
        autoFocus
        aria-label="Why should we check this? Optional."
        placeholder="Why should we check this? Optional."
      />
      <div className="flex items-center gap-2">
        <Button type="submit">Check this</Button>
        <Button variant="quiet" className="text-sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
