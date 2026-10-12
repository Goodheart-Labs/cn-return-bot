import { expect, test } from "bun:test";
import { closeCardsOpenedByReader, openCard } from "./cardChoices";

test("opening a card closes the card the reader opened before", () => {
  const choices = openCard(openCard(new Map(), "a"), "b");
  expect([...choices]).toEqual([["a", false], ["b", true]]);
});

test("opening a card leaves cards that opened by themselves alone", () => {
  // A card that opened by itself has no entry, and opening another card
  // must not give it one.
  expect(openCard(new Map(), "a").has("helpful")).toBe(false);
});

test("a card closed once stays closed after the reader opens it and clicks elsewhere", () => {
  const closedOnce = new Map([["helpful", false]]);
  const reopened = openCard(closedOnce, "helpful");
  expect(closeCardsOpenedByReader(reopened).get("helpful")).toBe(false);
});
