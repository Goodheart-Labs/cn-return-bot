import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  fetchLeaderboardPositionAtRank,
  moveToLeaderboard,
  removeRecommendation,
  restoreRecommendation,
  returnToRecommendations,
  setComment,
  setPosted,
  type CurationSection,
} from "@cn/core/bestNotes";
import type { ProjectHeader } from "@cn/core/types";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { IconButton } from "@cn/ui/IconButton";
import { CloseIcon, SpeechBubbleIcon, TrophyIcon, XLogoIcon } from "@cn/ui/icons";
import { CreatorLink } from "../../components/CreatorLink";
import type { Route } from "../../lib/routing";

/** Runs one change to the curation and then reloads every section, because a
 *  move or a removal changes two of them at once. It returns a function that
 *  reports whether the change went through. */
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
        client.invalidateQueries({ queryKey: queryKeys.curationSummaries }),
      ]);
    }
  };
}

/** Which small form is open under a note's bar. */
type Panel = "add" | "takeOff" | "comment" | "remove" | null;

const TEXTAREA = "w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
const NUMBER = "w-20 rounded-control border border-line-strong bg-surface px-2 py-1 text-sm text-fg tabular-nums";

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

/** A place on the leaderboard, typed as a number, with a button that sends it. */
function PlaceForm({ label, max, submit, onDone }: { label: string; max: number; submit: (rank: number) => Promise<boolean>; onDone: () => void }) {
  const [rank, setRank] = useState("");
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary"
      onSubmit={async (e) => {
        e.preventDefault();
        if (rank && (await submit(Number(rank)))) onDone();
      }}
    >
      <label className="flex items-center gap-2">
        Place
        <input type="number" min={1} max={max} value={rank} onChange={(e) => setRank(e.target.value)} className={NUMBER} autoFocus />
      </label>
      <span className="text-fg-muted">of {max}</span>
      <Button type="submit" disabled={!rank}>
        {label}
      </Button>
      <Button type="button" variant="secondary" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

/** The action buttons are a little larger than the default icon button, so
 *  they are easy to hit on a long page. */
const ICON_BUTTON = "h-8 w-8";

/** The top of a note's card on the curation page: its rank, its creator, the
 *  admin's actions for the section as symbols that name themselves on hover,
 *  and the comment or removal reason. One small form at a time opens below it.
 *  A recommendation has a trophy (add to our leaderboard), a speech bubble
 *  (comment) and a red cross (remove, with a reason). A leaderboard note has
 *  the X logo (mark as posted on X), the speech bubble, and a red cross that
 *  offers to send the note back to the recommendations or remove it. */
export function CurationBar({ section, rank, noteId, comment, posted, removedReason, project, leaderboardSize, navigate, onError }: {
  section: CurationSection;
  rank: number;
  noteId: string;
  comment: string | null;
  /** Whether an admin marked the note as posted on X. Only leaderboard notes have the mark. */
  posted: boolean;
  removedReason: string | null;
  project: ProjectHeader | undefined;
  /** How many notes the leaderboard holds, which an addition is placed among. */
  leaderboardSize: number;
  navigate: (route: Route) => void;
  onError: (message: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const change = useCurationChange(onError);
  const close = () => setPanel(null);
  const list = section === "leaderboard" ? "leaderboard" : "recommendations";

  const toggle = (next: Panel) => setPanel(panel === next ? null : next);
  const commentButton = (
    <IconButton label={comment ? "Edit the comment" : "Comment on its place"} onClick={() => toggle("comment")} className={ICON_BUTTON}>
      <SpeechBubbleIcon size={17} aria-hidden />
    </IconButton>
  );

  let actions: ReactNode;
  if (section === "recommendations") {
    actions = (
      <>
        <IconButton label="Add to our leaderboard" onClick={() => toggle("add")} className={ICON_BUTTON}>
          <TrophyIcon size={17} aria-hidden />
        </IconButton>
        {commentButton}
        <IconButton label="Remove from the recommendations" onClick={() => toggle("remove")} className={cn(ICON_BUTTON, "text-negative hover:text-negative")}>
          <CloseIcon size={17} aria-hidden />
        </IconButton>
      </>
    );
  } else if (section === "leaderboard") {
    actions = (
      <>
        <IconButton
          label={posted ? "Posted on X. Click to unmark" : "Mark as posted on X"}
          onClick={() => void change(() => setPosted(noteId, !posted))}
          className={cn(ICON_BUTTON, posted ? "bg-tint text-fg hover:text-fg" : "")}
        >
          <XLogoIcon size={15} aria-hidden />
        </IconButton>
        {commentButton}
        <IconButton label="Take off the leaderboard" onClick={() => toggle("takeOff")} className={cn(ICON_BUTTON, "text-negative hover:text-negative")}>
          <CloseIcon size={17} aria-hidden />
        </IconButton>
      </>
    );
  } else {
    actions = (
      <Button variant="link" className="text-sm" onClick={() => void change(() => restoreRecommendation(noteId))}>
        Restore
      </Button>
    );
  }

  let form: ReactNode = null;
  if (panel === "add") {
    form = (
      <div className="space-y-2">
        <Button onClick={() => void change(async () => moveToLeaderboard(noteId, await fetchLeaderboardPositionAtRank(leaderboardSize + 1, leaderboardSize)))}>
          Add at the bottom ({leaderboardSize + 1})
        </Button>
        <PlaceForm
          label="Add here"
          max={leaderboardSize + 1}
          submit={(r) => change(async () => moveToLeaderboard(noteId, await fetchLeaderboardPositionAtRank(r, leaderboardSize)))}
          onDone={close}
        />
      </div>
    );
  } else if (panel === "takeOff") {
    form = (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void change(() => returnToRecommendations(noteId))}>
          Back to recommendations
        </Button>
        <Button variant="secondary" onClick={() => setPanel("remove")}>
          Remove
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
        submit={(text) => change(() => setComment(list, noteId, text))}
        onDone={close}
      />
    );
  } else if (panel === "remove") {
    form = (
      <TextForm
        label="Remove"
        initial=""
        placeholder="Why remove it? (optional)"
        // A leaderboard note goes back among the recommendations first, so
        // its removal and reason are recorded like any other.
        submit={(text) =>
          change(async () => {
            if (section === "leaderboard") await returnToRecommendations(noteId);
            await removeRecommendation(noteId, text);
          })
        }
        onDone={close}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-title text-base font-bold text-fg-secondary">#{rank}</span>
        {project && <CreatorLink project={project} navigate={navigate} />}
        <span className="ml-auto flex items-center gap-1">{actions}</span>
      </div>
      {section !== "removed" && comment && panel !== "comment" && (
        <p className="rounded-control bg-surface-muted px-3 py-2 text-sm text-fg-secondary">
          <span className="font-medium text-fg">Comment:</span> {comment}
        </p>
      )}
      {section === "removed" && (
        <p className="rounded-control bg-surface-muted px-3 py-2 text-sm text-fg-secondary">
          <span className="font-medium text-fg">Removed:</span> {removedReason ?? "no reason given"}
        </p>
      )}
      {form}
    </div>
  );
}
