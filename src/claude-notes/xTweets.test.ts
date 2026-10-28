import { describe, expect, test } from "bun:test";
import { xNoteProblems } from "./xTweets";

describe("xNoteProblems", () => {
  test("accepts a note within the limit that has a link", () => {
    expect(xNoteProblems(`${"a".repeat(270)} https://example.com/a-very-long-path-that-counts-as-one`)).toEqual([]);
  });

  test("counts each link as one character", () => {
    expect(xNoteProblems(`${"a".repeat(279)} https://example.com`)).toHaveLength(1);
  });

  test("requires a link", () => {
    expect(xNoteProblems("The photo is from 2019.")).toEqual(["The note has no link. X requires at least one source link."]);
  });
});
