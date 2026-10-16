import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveRequestProgress, PASSAGE_CHECK, progressLines } from "@cn/core/requestProgress";
import { ReaderContext, type ReaderApi } from "../context";
import { requestNoteModule } from "./requestNote";

const quote = "close the bridge for repairs";
const checkedItem = { id: "item-1", status: "done" as const, checked_scope: "page" as const, progress: null };

const render = (api: ReaderApi, blockId: string) =>
  renderToStaticMarkup(createElement(ReaderContext.Provider, { value: api }, createElement(requestNoteModule.MarginEntries!, { blockId })));

test("a request's card shows its words and the shared progress lines, only beside its own passage", () => {
  for (const [status, reason] of [["enqueued", PASSAGE_CHECK.running], ["done", PASSAGE_CHECK.note]] as const) {
    const progress = deriveRequestProgress(checkedItem, [], { item_id: "item-1", status, status_reason: reason });
    const api = {
      scope: "main",
      noteRequests: [{ id: "0", blockId: "b1", quote, progress }],
      wide: true,
      slotMode: () => "auto",
      openedRank: () => undefined,
      openEntry: () => {},
      closeEntry: () => {},
      entryNavigation: () => null,
    } as unknown as ReaderApi;
    expect(requestNoteModule.marginCount!(api, "b1")).toBe(1);
    expect(requestNoteModule.marginCount!(api, "b2")).toBe(0);
    const html = render(api, "b1");
    expect(html).toContain(quote);
    for (const line of progressLines(progress)) expect(html).toContain(line);
    expect(render(api, "b2")).toBe("");
  }
});
