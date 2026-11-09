import { beforeEach, expect, mock, test } from "bun:test";

const sent: { event: string; props: Record<string, unknown> }[] = [];
void mock.module("@cn/core/analytics", () => ({ track: (event: string, props: Record<string, unknown>) => sent.push({ event, props }) }));
const { flushNoteViews, noteOpened, noteSeen } = await import("./noteViews");

beforeEach(() => {
  flushNoteViews();
  sent.length = 0;
});

test("a note is seen once per page, and the views go out as one batch", () => {
  noteSeen("inline", ["a", "b"]);
  noteSeen("inline", ["b", "c"]);
  expect(sent).toEqual([]);
  flushNoteViews();
  expect(sent).toEqual([{ event: "note_seen", props: { surface: "inline", note_ids: ["a", "b", "c"] } }]);
  noteSeen("inline", ["a"]);
  flushNoteViews();
  expect(sent).toHaveLength(1);
});

test("every open counts, and a big batch is split to fit the props cap", () => {
  noteOpened("youtube", ["x"]);
  noteOpened("youtube", ["x"]);
  noteSeen("youtube", Array.from({ length: 45 }, (_, i) => `n${i}`));
  flushNoteViews();
  expect(sent.map((e) => [e.event, (e.props.note_ids as string[]).length])).toEqual([
    ["note_seen", 30],
    ["note_seen", 15],
    ["note_opened", 2],
  ]);
});
