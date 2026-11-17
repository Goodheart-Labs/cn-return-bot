import { describe, expect, test } from "bun:test";
import { missingOriginals } from "./reviewQueries";

const note = (id: string, improvedFrom: string | null) => ({ id, improved_from_note_id: improvedFrom });

describe("missingOriginals", () => {
  test("names each original once and skips the ones already loaded", () => {
    expect(missingOriginals([note("a", null), note("b", "x"), note("c", "x"), note("d", "a")])).toEqual(["x"]);
  });

  test("is empty when no note is an improvement", () => {
    expect(missingOriginals([note("a", null)])).toEqual([]);
  });
});
