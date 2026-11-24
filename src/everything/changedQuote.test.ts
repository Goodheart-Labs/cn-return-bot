import { expect, test } from "bun:test";
import { compareQuote } from "./changedQuote";

const INTRO = "The essay opens with a long paragraph about dams and the power they make, which runs on for a good while so the claim has text before it. ";
const OUTRO = " The essay then goes on with more sentences after the claim, about turbines, rivers and the people who live along them, and it ends some time later.";
const QUOTE = "We estimate that the datacenter would require 300 MW, or 5% of the capacity of the dam.";
const STORED = INTRO + QUOTE + OUTRO;

test("a number corrected inside the passage is a change, with the new sentence", () => {
  const live = STORED.replace("5%", "0.5%");
  expect(compareQuote(QUOTE, STORED, live)).toEqual({ kind: "changed", nowReads: "We estimate that the datacenter would require 300 MW, or 0.5% of the capacity of the dam." });
});

test("half a sentence dropped is a change", () => {
  const stored = INTRO + "I recommend Longview and the Survival and Flourishing Fund." + OUTRO;
  const live = INTRO + "I recommend Longview." + OUTRO;
  expect(compareQuote("I recommend Longview and the Survival and Flourishing Fund.", stored, live)).toEqual({ kind: "changed", nowReads: "I recommend Longview." });
});

test("the same passage with other line breaks, quotes and emphasis is still there", () => {
  const live = STORED.replace(QUOTE, "We estimate that the *datacenter* would\nrequire 300 MW, or 5% of the capacity of the dam.");
  expect(compareQuote(QUOTE, STORED, live)).toEqual({ kind: "still_there" });
});

test("a post cut off before the passage, as behind a paywall, is not a change", () => {
  expect(compareQuote(QUOTE, STORED, INTRO + "Subscribe to keep reading.")).toEqual({ kind: "cut_off" });
});

test("a passage taken out with nothing in its place is removed", () => {
  expect(compareQuote(QUOTE, STORED, INTRO + OUTRO)).toEqual({ kind: "removed" });
});

test("a passage whose surroundings were rewritten too gives no new text", () => {
  const tail = " More text follows here, sentence after sentence, so the post has a long stretch well past the claim. ".repeat(12);
  const live = "A new opening altogether. Something else stands here now." + tail;
  const stored = INTRO + QUOTE + OUTRO + tail;
  expect(compareQuote(QUOTE, stored, live)).toEqual({ kind: "rewritten" });
});

test("a passage the note quotes loosely cannot be compared", () => {
  expect(compareQuote("The datacenter needs about 300 MW of power in all.", STORED, STORED)).toEqual({ kind: "not_in_stored" });
});

test("a passage that ends the post is never called changed, because a cut-off post would look the same", () => {
  const stored = INTRO + QUOTE;
  expect(compareQuote(QUOTE, stored, stored.replace("5%", "0.5%")).kind).not.toBe("changed");
  expect(compareQuote(QUOTE, stored, INTRO + "Subscribe to keep reading.").kind).not.toBe("changed");
});

test("a passage that opens the post is never called changed", () => {
  const stored = QUOTE + OUTRO;
  expect(compareQuote(QUOTE, stored, stored.replace("5%", "0.5%")).kind).not.toBe("changed");
});
