import { describe, expect, test } from "bun:test";
import { firstHelpfulVoteIsSince, noteAnnouncements } from "./announcements";
import { packIntoMessages, type NoteWithContext } from "./messages";

const ZVI = { slug: "thezvi", name: "Don't Worry About the Vase", feed_url: "https://thezvi.substack.com" };
const OTHER = { slug: "someone", name: "Someone Else", feed_url: "https://someone.substack.com" };

function note(overrides: Partial<NoteWithContext> & { itemId?: string; itemStatus?: string; project?: typeof ZVI }): NoteWithContext {
  const { itemId = "item-1", itemStatus = "done", project = ZVI, ...rest } = overrides;
  return {
    id: "note-1",
    note: "The figure is from 2019, not 2024.",
    created_at: "2026-10-01T12:00:00Z",
    author_id: null,
    author_name: null,
    improved_from_note_id: null,
    helpful_count: 0,
    somewhat_helpful_count: 0,
    not_helpful_count: 0,
    claim: {
      claim: "Spending rose 40% in 2024.",
      context_quote: "spending rose 40% last year",
      item: { id: itemId, title: "AI #100", url: "https://thezvi.substack.com/p/ai-100", status: itemStatus, project },
    },
    ...rest,
  };
}

const summarize = (notes: NoteWithContext[]) => noteAnnouncements(notes).map((a) => `${a.channel}:${a.subjectId}`);

describe("noteAnnouncements", () => {
  test("AI notes on an important creator's finished post become one announcement for the post", () => {
    const notes = [note({ id: "a" }), note({ id: "b" })];
    expect(summarize(notes)).toEqual(["on_important_creator:item-1"]);
    expect(noteAnnouncements(notes)[0]!.messages[0]).toStartWith("**2 new notes** on [AI #100]");
  });

  test("AI notes wait while their post is still being checked", () => {
    expect(summarize([note({ itemStatus: "processing" })])).toEqual([]);
  });

  test("AI notes on other creators are not announced", () => {
    expect(summarize([note({ project: OTHER })])).toEqual([]);
  });

  test("a person's note goes to written_by_human, and also to on_important_creator on an important creator", () => {
    expect(summarize([note({ id: "h", author_id: "u", author_name: "Ada" })])).toEqual([
      "written_by_human:h",
      "on_important_creator:h",
    ]);
    expect(summarize([note({ id: "h", author_id: "u", project: OTHER })])).toEqual(["written_by_human:h"]);
  });
});

describe("firstHelpfulVoteIsSince", () => {
  const since = "2026-10-01T00:00:00Z";
  const vote = (voter_id: string, updated_at: string) => ({ id: `${voter_id}-v`, note_id: "note-1", voter_id, updated_at });

  test("a recent Helpful vote from someone else is the first", () => {
    expect(firstHelpfulVoteIsSince(note({}), [vote("x", "2026-10-01T10:00:00Z")], since)).toBe(true);
  });

  test("the author's own vote never counts", () => {
    const authored = note({ author_id: "u" });
    expect(firstHelpfulVoteIsSince(authored, [vote("u", "2026-10-01T10:00:00Z")], since)).toBe(false);
  });

  test("an older Helpful vote means the recent one is not the first", () => {
    const votes = [vote("x", "2026-09-20T10:00:00Z"), vote("y", "2026-10-01T10:00:00Z")];
    expect(firstHelpfulVoteIsSince(note({}), votes, since)).toBe(false);
  });
});

describe("packIntoMessages", () => {
  test("keeps everything in one message while it fits", () => {
    expect(packIntoMessages("head", ["a", "b"])).toEqual(["head\n\na\n\nb"]);
  });

  test("starts a new message when Slack's length limit would be passed", () => {
    const big = "x".repeat(7_000);
    expect(packIntoMessages("head", [big, big])).toEqual([`head\n\n${big}`, big]);
  });
});
