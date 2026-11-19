import { expect, test } from "bun:test";
import { publicVerdicts } from "./publicVerdicts";

const votes = (noteId: string, helpful: number, notHelpful: number, voter = "reader") => [
  ...Array.from({ length: helpful }, (_, i) => ({ note_id: noteId, voter_id: `${voter}-h${i}`, vote: 1 })),
  ...Array.from({ length: notHelpful }, (_, i) => ({ note_id: noteId, voter_id: `${voter}-n${i}`, vote: -1 })),
];

test("keeps only notes the public settled on, Not helpful first", () => {
  const all = [...votes("liked", 5, 1), ...votes("disliked", 4, 15), ...votes("split", 6, 8), ...votes("thin", 2, 0), ...votes("loved", 9, 0)];
  expect(publicVerdicts(all, new Set()).map((v) => [v.noteId, v.verdict, v.helpful, v.notHelpful])).toEqual([
    ["disliked", "Not helpful", 4, 15],
    ["loved", "Helpful", 9, 0],
    ["liked", "Helpful", 5, 1],
  ]);
});

test("leaves out team votes and Somewhat helpful votes", () => {
  const team = new Set(["jim", "nathan", "ana"]);
  const all = [
    ...["jim", "nathan", "ana"].map((voter_id) => ({ note_id: "ours", voter_id, vote: 1 })),
    ...["a", "b", "c"].map((voter_id) => ({ note_id: "meh", voter_id, vote: 0 })),
  ];
  expect(publicVerdicts(all, team)).toEqual([]);
});
