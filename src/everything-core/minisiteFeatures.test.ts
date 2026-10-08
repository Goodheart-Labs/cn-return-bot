import { expect, test } from "bun:test";
import { ALL_FEATURES, enabledFeatures } from "./minisiteFeatures";

test("every feature on gives every feature", () => {
  expect([...enabledFeatures(ALL_FEATURES)].sort()).toEqual([...ALL_FEATURES].sort());
});

test("a child counts only while its parent is on", () => {
  const on = enabledFeatures(["highlight.note", "passage", "passage.note"]);
  expect(on.has("highlight.note")).toBe(false);
  expect(on.has("passage.note")).toBe(true);
});

test("Opus's abilities need a place to ask Opus", () => {
  const without = enabledFeatures(["opus", "opus.search", "highlight", "highlight.forecast"]);
  expect(without.has("opus.search")).toBe(false);
  const withAsk = enabledFeatures(["opus", "opus.search", "passage", "passage.askOpus"]);
  expect(withAsk.has("opus.search")).toBe(true);
});

test("drafting needs a highlight kind to draft", () => {
  const ask = ["opus", "opus.drafts", "passage", "passage.askOpus"];
  expect(enabledFeatures(ask).has("opus.drafts")).toBe(false);
  expect(enabledFeatures([...ask, "highlight", "highlight.keyPoint"]).has("opus.drafts")).toBe(true);
});

test("unknown stored ids are ignored", () => {
  expect([...enabledFeatures(["notes", "notes.checked", "retired"])]).toEqual(["notes"]);
});
