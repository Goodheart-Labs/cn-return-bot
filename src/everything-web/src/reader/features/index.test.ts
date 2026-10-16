import { expect, test } from "bun:test";
import { ALL_FEATURES } from "@cn/core/minisiteFeatures";
import { parseReaderText } from "@cn/core/readerText";
import type { ReaderApi } from "../context";
import { READER_MODULES } from "./index";

const block = parseReaderText("The council voted to close the bridge for repairs next spring.")[0]!;
const api = { scope: "main", features: new Set(ALL_FEATURES), noteRequests: [], item: { status: "done", checked_scope: "page" } } as unknown as ReaderApi;

test("the toolbar on selected words", () => {
  const actions = READER_MODULES.flatMap((module) => module.selectionActions?.(api, block, "close the bridge for repairs") ?? []);
  expect(actions.map((action) => action.label)).toEqual(["Write note", "Request note", "Forecast", "Key point", "Ask Opus"]);
  expect(actions.map((action) => action.feature)).toEqual(["highlight.note", "highlight.request", "highlight.forecast", "highlight.keyPoint", "highlight.askOpus"]);
});

test("Request note waits until the article itself has been checked", () => {
  const unchecked = { ...api, item: { status: "done", checked_scope: null } } as unknown as ReaderApi;
  const labels = READER_MODULES.flatMap((module) => module.selectionActions?.(unchecked, block, "close the bridge for repairs") ?? []).map((action) => action.label);
  expect(labels).toEqual(["Write note", "Forecast", "Key point", "Ask Opus"]);
});

test("the buttons under a paragraph", () => {
  const actions = READER_MODULES.flatMap((module) => module.passageActions?.(api, block) ?? []);
  expect(actions.map((action) => action.label)).toEqual(["Ask Opus about this paragraph"]);
});

test("every button's accessible name contains its label", () => {
  const actions = READER_MODULES.flatMap((module) => [...(module.selectionActions?.(api, block, "close the bridge") ?? []), ...(module.passageActions?.(api, block) ?? [])]);
  for (const action of actions) expect(action.accessibleName.toLowerCase()).toContain(action.label.toLowerCase());
});
