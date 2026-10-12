import { describe, expect, test } from "bun:test";
import type { NoteRow } from "@cn/core/types";
import { noteSetOf } from "@cn/features/notes/noteSet";
import { claimGroups, noteCounts } from "./claimGroups";
import { DEFAULT_NOTE_DISPLAY } from "./settings";

// Three Helpful votes rate a note helpful, two Not-helpful votes rate it not
// helpful, and a note without votes needs more ratings (everything-core/noteScore.ts).
const TALLIES = {
  helpful: { helpful_count: 3, somewhat_helpful_count: 0, not_helpful_count: 0 },
  needs_ratings: { helpful_count: 0, somewhat_helpful_count: 0, not_helpful_count: 0 },
  not_helpful: { helpful_count: 0, somewhat_helpful_count: 0, not_helpful_count: 2 },
};

function note(id: string, claimId: string, status: keyof typeof TALLIES): NoteRow {
  return {
    id,
    claim_id: claimId,
    author_id: null,
    improved_from_note_id: null,
    created_at: "2026-09-29T00:00:00Z",
    claim: { id: claimId },
    ...TALLIES[status],
  } as unknown as NoteRow;
}

const groupsOf = (notes: NoteRow[], display = DEFAULT_NOTE_DISPLAY) => claimGroups(noteSetOf(notes, []), display);

describe("claimGroups", () => {
  test("a claim takes the best status and the most prominent display among its notes", () => {
    const [group] = groupsOf([note("a", "c1", "not_helpful"), note("b", "c1", "helpful")]);
    expect(group!.status).toBe("helpful");
    expect(group!.display).toBe("open");
  });

  test("by default a claim that needs ratings is collapsed and an unhelpful one is a dot", () => {
    const groups = groupsOf([note("a", "c1", "needs_ratings"), note("b", "c1", "not_helpful"), note("c", "c2", "not_helpful")]);
    expect(groups.map((g) => [g.claimId, g.status, g.display])).toEqual([
      ["c1", "needs_ratings", "collapse"],
      ["c2", "not_helpful", "dot"],
    ]);
  });

  test("hidden notes leave their claim, and a claim with only hidden notes disappears", () => {
    const display = { ...DEFAULT_NOTE_DISPLAY, not_helpful: "hide" as const };
    const groups = groupsOf([note("a", "c1", "not_helpful"), note("b", "c2", "not_helpful"), note("c", "c2", "needs_ratings")], display);
    expect(groups.map((g) => g.claimId)).toEqual(["c2"]);
    expect(groups[0]!.notes.map((n) => n.id)).toEqual(["c"]);
  });
});

describe("noteCounts", () => {
  test("status counts ignore the display choices, visible leaves out hidden notes", () => {
    const display = { ...DEFAULT_NOTE_DISPLAY, not_helpful: "hide" as const };
    const notes = [note("a", "c1", "helpful"), note("b", "c1", "needs_ratings"), note("c", "c2", "not_helpful")];
    expect(noteCounts(notes, display)).toEqual({ helpful: 1, needsRatings: 1, notHelpful: 1, visible: 2 });
  });
});
