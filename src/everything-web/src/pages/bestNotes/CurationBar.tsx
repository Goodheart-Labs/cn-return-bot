import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  moveToLeaderboard,
  positionAtRank,
  removeRecommendation,
  restoreRecommendation,
  returnToRecommendations,
  setComment,
  setPosition,
  type CuratedNoteRow,
  type CurationSection,
} from "@cn/core/bestNotes";
import type { FeedProjectRow } from "@cn/core/types";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { ProjectAvatar } from "../../components/ProjectAvatar";
import { RouteLink } from "../../components/RouteLink";
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
        client.invalidateQueries({ queryKey: ["curatedList"] }),
        client.invalidateQueries({ queryKey: queryKeys.removedRecommendations }),
      ]);
    }
  };
}

/** Which small form is open under a note's bar. */
type Panel = "add" | "place" | "comment" | "remove" | null;

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

const actionClass = "text-sm font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-control";

function Action({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={actionClass}>
      {children}
    </button>
  );
}

/** The top of a note's card on the curation page: its rank, its creator, the
 *  admin's actions for the section, and the comment or removal reason. One
 *  small form at a time opens below it. */
export function CurationBar({ section, rank, noteId, comment, removedReason, project, leaderboard, navigate, onError }: {
  section: CurationSection;
  rank: number;
  noteId: string;
  comment: string | null;
  removedReason: string | null;
  project: FeedProjectRow | undefined;
  /** The leaderboard in its order, which a move or an addition is placed in. */
  leaderboard: CuratedNoteRow[];
  navigate: (route: Route) => void;
  onError: (message: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const change = useCurationChange(onError);
  const close = () => setPanel(null);
  const list = section === "leaderboard" ? "leaderboard" : "recommendations";
  const othersOnLeaderboard = leaderboard.filter((row) => row.note_id !== noteId);

  let actions: ReactNode;
  if (section === "recommendations") {
    actions = (
      <>
        <Action onClick={() => setPanel(panel === "add" ? null : "add")}>Add to leaderboard</Action>
        <Action onClick={() => setPanel(panel === "comment" ? null : "comment")}>Comment</Action>
        <Action onClick={() => setPanel(panel === "remove" ? null : "remove")}>Remove</Action>
      </>
    );
  } else if (section === "leaderboard") {
    actions = (
      <>
        <Action onClick={() => setPanel(panel === "place" ? null : "place")}>Move to place</Action>
        <Action onClick={() => setPanel(panel === "comment" ? null : "comment")}>Comment</Action>
        <Action onClick={() => void change(() => returnToRecommendations(noteId))}>Back to recommendations</Action>
      </>
    );
  } else {
    actions = <Action onClick={() => void change(() => restoreRecommendation(noteId))}>Restore</Action>;
  }

  let form: ReactNode = null;
  if (panel === "add") {
    form = (
      <div className="space-y-2">
        <Button onClick={() => void change(() => moveToLeaderboard(noteId, positionAtRank(leaderboard, leaderboard.length + 1)))}>
          Add at the bottom ({leaderboard.length + 1})
        </Button>
        <PlaceForm label="Add here" max={leaderboard.length + 1} submit={(r) => change(() => moveToLeaderboard(noteId, positionAtRank(leaderboard, r)))} onDone={close} />
      </div>
    );
  } else if (panel === "place") {
    form = (
      <PlaceForm
        label="Move"
        max={leaderboard.length}
        submit={(r) => change(() => setPosition("leaderboard", noteId, positionAtRank(othersOnLeaderboard, r)))}
        onDone={close}
      />
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
        submit={(text) => change(() => removeRecommendation(noteId, text))}
        onDone={close}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-title text-base font-bold text-fg-secondary">#{rank}</span>
        {project && (
          <RouteLink
            to={{ view: "notes", project: project.slug, item: null, note: null }}
            navigate={navigate}
            className="inline-flex items-center gap-2 text-sm font-medium text-fg-secondary hover:text-fg"
          >
            <ProjectAvatar project={project} size={22} />
            {project.name}
          </RouteLink>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">{actions}</span>
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
