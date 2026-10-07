import { expect, test } from "bun:test";
import { highlightSentence, parseHighlightDraft, validHighlight } from "./passageHighlights";

test("highlight sentences", () => {
  expect(highlightSentence({ kind: "forecast", probability: 65, statement: "It rains tomorrow" })).toBe("This is a forecast of a 65% chance of “It rains tomorrow”");
  expect(highlightSentence({ kind: "key_point", statement: "Costs are falling" })).toBe("A key point in this article is “Costs are falling”");
});

test("only forecasts require an integer probability, including the endpoints", () => {
  for (const probability of [0, 1, 50, 100]) expect(validHighlight("forecast", probability, "Rain")).toBe(true);
  for (const probability of [null, -1, 101, 50.5, NaN, Infinity]) expect(validHighlight("forecast", probability, "Rain")).toBe(false);
  expect(validHighlight("key_point", null, "Costs")).toBe(true);
  expect(validHighlight("key_point", 0, "Costs")).toBe(false);
  expect(validHighlight("forecast", 50, " ")).toBe(false);
  expect(parseHighlightDraft({ kind: "forecast", probability: "50", statement: "Rain" })).toBeNull();
  expect(parseHighlightDraft({ kind: "key_point", statement: "Costs" })).toEqual({ kind: "key_point", statement: "Costs" });
});
