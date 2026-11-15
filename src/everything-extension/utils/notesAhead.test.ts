import { expect, test } from "bun:test";
import { notesAllAhead } from "./notesAhead";

test("the pill shows only while every note is still below the window", () => {
  expect(notesAllAhead([{ top: 1500, bottom: 1520 }, { top: 3000, bottom: 3020 }], 900)).toBe(true);
  // One passage on screen: the reader has reached the notes.
  expect(notesAllAhead([{ top: 400, bottom: 420 }, { top: 3000, bottom: 3020 }], 900)).toBe(false);
  // Scrolled past one: also reached.
  expect(notesAllAhead([{ top: -300, bottom: -280 }, { top: 3000, bottom: 3020 }], 900)).toBe(false);
  // A passage starting right at the bottom edge is not on screen yet.
  expect(notesAllAhead([{ top: 900, bottom: 920 }], 900)).toBe(true);
  expect(notesAllAhead([], 900)).toBe(false);
});
