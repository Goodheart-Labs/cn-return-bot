import { expect, test } from "bun:test";
import { ALL_FEATURES, enabledFeatures } from "./minisiteFeatures";

test("every feature on gives every feature", () => {
  expect([...enabledFeatures(ALL_FEATURES)].sort()).toEqual([...ALL_FEATURES].sort());
});

test("a child counts only while its parent is on", () => {
  const on = enabledFeatures(["highlight.request", "passage", "passage.askOpus"]);
  expect(on.has("highlight.request")).toBe(false);
  expect(on.has("passage.askOpus")).toBe(true);
});

test("Opus's abilities need a place to ask Opus", () => {
  const without = enabledFeatures(["opus", "opus.search", "highlight", "highlight.forecast"]);
  expect(without.has("opus.search")).toBe(false);
  const withAsk = enabledFeatures(["opus", "opus.search", "passage", "passage.askOpus"]);
  expect(withAsk.has("opus.search")).toBe(true);
});

test("drafting needs a note, key point or forecast to draft", () => {
  const ask = ["opus", "opus.drafts", "passage", "passage.askOpus"];
  expect(enabledFeatures(ask).has("opus.drafts")).toBe(false);
  expect(enabledFeatures([...ask, "highlight", "highlight.keyPoint"]).has("opus.drafts")).toBe(true);
  expect(enabledFeatures([...ask, "highlight", "highlight.note"]).has("opus.drafts")).toBe(true);
});

test("unknown stored ids are ignored", () => {
  expect([...enabledFeatures(["notes", "notes.checked", "retired"])]).toEqual(["notes"]);
});

test("a stored paragraph note button is ignored", () => {
  expect([...enabledFeatures(["passage", "passage.note", "passage.askOpus"])]).toEqual(["passage", "passage.askOpus"]);
});
