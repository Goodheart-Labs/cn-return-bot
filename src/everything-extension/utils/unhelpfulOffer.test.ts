import { beforeEach, expect, test } from "bun:test";
import { fakeBrowser } from "@webext-core/fake-browser";
import { countUnhelpfulNotesSeen } from "./unhelpfulOffer";

beforeEach(() => fakeBrowser.reset());

test("the link goes on the first unhelpful note seen, and then on every fifth", async () => {
  const offers = [];
  for (let card = 0; card < 11; card++) offers.push(await countUnhelpfulNotesSeen(1));
  expect(offers.map((index) => index !== null)).toEqual([true, false, false, false, false, true, false, false, false, false, true]);
});

test("in a card with several unhelpful notes, the link goes on the one whose turn it is", async () => {
  await countUnhelpfulNotesSeen(3);
  expect(await countUnhelpfulNotesSeen(3)).toBe(2);
});
