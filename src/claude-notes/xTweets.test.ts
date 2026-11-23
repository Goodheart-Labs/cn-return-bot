import { describe, expect, test } from "bun:test";
import { sourceProblems, xNoteProblems } from "./xTweets";

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

describe("sourceProblems", () => {
  const note = "The photo is from 2019. https://example.com/a https://example.com/b";
  const source = (url: string) => ({ url, quote: "Taken in 2019.", explanation: "The date of the photo." });

  test("accepts a note whose every link has its details", () => {
    expect(sourceProblems(note, [source("https://example.com/a"), source("https://example.com/b")])).toEqual([]);
  });

  test("names a link without details, and a source without a quote", () => {
    expect(sourceProblems(note, [{ ...source("https://example.com/a"), quote: " " }])).toEqual([
      "The source https://example.com/a needs a url, a quote and an explanation.",
      'The link https://example.com/b is in the note but not in "sources".',
    ]);
  });

  test("refuses a note without sources", () => {
    expect(sourceProblems(note, undefined)).toHaveLength(1);
  });
});
