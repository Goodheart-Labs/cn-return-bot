import { expect, test } from "bun:test";
import { parseRevision } from "./models";

const note = { text: "Greater Mumbai counted 5.2 million slum residents in 2011.", sources: ["https://example.gov/census.pdf"] };

test("a revised note is accepted when it fits X's limits", () => {
  expect(parseRevision({ action: "revise", reply: "Here it is.", note })).toEqual({ action: "revise", reply: "Here it is.", note });
  expect(parseRevision({ action: "keep", reply: "It stays.", note: null })).toEqual({ action: "keep", reply: "It stays." });
});

test("a revised note that breaks X's limits is refused, so the model is asked again", () => {
  expect(() => parseRevision({ action: "revise", reply: "Here.", note: { ...note, text: "x".repeat(281) } })).toThrow("too long");
  expect(() => parseRevision({ action: "revise", reply: "Here.", note: { ...note, sources: [] } })).toThrow("one to five links");
  expect(() => parseRevision({ action: "revise", reply: "Here.", note: { ...note, sources: ["not a link"] } })).toThrow("one to five links");
  expect(() => parseRevision({ action: "keep", reply: "" })).toThrow("no reply");
});
