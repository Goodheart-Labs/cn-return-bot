import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { removeFromLeaderboard, setComment } from "@cn/core/bestNotes";
import type { ProjectHeader } from "@cn/core/types";
import { setXMark } from "@cn/core/xMarks";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { focusRing } from "@cn/ui/focusRing";
import { IconButton } from "@cn/ui/IconButton";
import { CloseIcon, SpeechBubbleIcon, XLogoIcon } from "@cn/ui/icons";
import { CreatorLink } from "../../components/CreatorLink";
import type { Route } from "../../lib/routing";

/** Runs one change to the leaderboard and then reloads it and its counts. It
 *  returns a function that reports whether the change went through. */
export function useCurationChange(onError: (message: string) => void) {
  const client = useQueryClient();
  return async (write: () => Promise<void>): Promise<boolean> => {
    try {
      await write();
      return true;
    } catch (err) {
      onError((err as Error).message);
      return false;
    } finally {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.curation }),
        client.invalidateQueries({ queryKey: queryKeys.curationSummary }),
      ]);
    }
  };
}

/** Which small form is open under a note's bar. */
type Panel = "takeOff" | "comment" | null;

const TEXTAREA = cn("w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-fg", focusRing);

/** A box for a short text, with a button that sends it. */
function TextForm({ label, initial, placeholder, submit, onDone }: {
  label: string;
  initial: string;
  placeholder: string;
  submit: (text: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await submit(text)) onDone();
        setBusy(false);
      }}
    >
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={placeholder} className={TEXTAREA} autoFocus />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {label}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The action buttons are a little larger than the default icon button, so
 *  they are easy to hit on a long page. */
const ICON_BUTTON = "h-8 w-8";

/** The top of a note's card on the leaderboard: its rank, its creator, the
 *  admin's actions as symbols that name themselves on hover, and the comment.
 *  The X logo marks the note as posted on X, the speech bubble edits the
 *  comment, and the red cross takes the note off the leaderboard after a
 *  confirmation. One small form at a time opens below the bar. */
export function CurationBar({ rank, noteId, comment, posted, project, navigate, onError }: {
  rank: number;
  noteId: string;
  comment: string | null;
  /** Whether an admin marked the note as posted on X. */
  posted: boolean;
  project: ProjectHeader | undefined;
  navigate: (route: Route) => void;
  onError: (message: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const change = useCurationChange(onError);
  const close = () => setPanel(null);
  const toggle = (next: Panel) => setPanel(panel === next ? null : next);

  let form: ReactNode = null;
  if (panel === "takeOff") {
    form = (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Take this note off the leaderboard?</span>
        <Button variant="secondary" onClick={() => void change(() => removeFromLeaderboard(noteId))}>
          Take it off
        </Button>
        <Button variant="link" onClick={close}>
          Cancel
        </Button>
      </div>
    );
  } else if (panel === "comment") {
    form = (
      <TextForm
        label="Save comment"
        initial={comment ?? ""}
        placeholder="Why does this note sit here?"
        submit={(text) => change(() => setComment(noteId, text))}
        onDone={close}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-title text-base font-bold text-fg-secondary">#{rank}</span>
        {project && <CreatorLink project={project} navigate={navigate} />}
        <span className="ml-auto flex items-center gap-1">
          <IconButton
            label={posted ? "Posted on X. Click to unmark" : "Mark as posted on X"}
            onClick={() => void change(() => setXMark(noteId, posted ? null : "posted"))}
            className={cn(ICON_BUTTON, posted ? "bg-tint text-fg hover:text-fg" : "")}
          >
            <XLogoIcon size={15} aria-hidden />
          </IconButton>
          <IconButton label={comment ? "Edit the comment" : "Comment on its place"} onClick={() => toggle("comment")} className={ICON_BUTTON}>
            <SpeechBubbleIcon size={17} aria-hidden />
          </IconButton>
          <IconButton label="Take off the leaderboard" onClick={() => toggle("takeOff")} className={cn(ICON_BUTTON, "text-negative hover:text-negative")}>
            <CloseIcon size={17} aria-hidden />
          </IconButton>
        </span>
      </div>
      {comment && panel !== "comment" && (
        <p className="rounded-control bg-surface-muted px-3 py-2 text-sm text-fg-secondary">
          <span className="font-medium text-fg">Comment:</span> {comment}
        </p>
      )}
      {form}
    </div>
  );
}
