import { afterEach, describe, expect, test } from "bun:test";
import { NotesFeed, formatPostedNote, type PostedNote } from "./feed";
import { SignalStore } from "./store";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function note(id: string, submitted_at: string, overrides: Partial<PostedNote> = {}): PostedNote {
  return { note_id: id, tweet_id: `t${id}`, note_text: `Note ${id} https://example.org/${id}`, bot_name: "simple-bot", submitted_at, ...overrides };
}

describe("notes feed", () => {
  test("starts from now, posts new notes oldest first, and never re-posts a sent note", async () => {
    const store = new SignalStore(":memory:", "feed-test");
    cleanups.push(() => store.close());
    let clock = new Date("2026-09-17T18:00:00.000Z");
    const rows: PostedNote[] = [note("old", "2026-09-17T17:00:00.000Z")];
    const sent: string[] = [];
    const queries: string[] = [];
    const feed = new NotesFeed({
      store, now: () => clock,
      listNotesSince: async (since) => { queries.push(since); return rows.filter((row) => row.submitted_at >= since); },
      send: async (text) => { sent.push(text); },
    });
    expect(await feed.poll()).toBe(0);
    expect(queries).toEqual(["2026-09-17T18:00:00.000Z"]);
    rows.push(note("b", "2026-09-17T18:05:00.000Z"), note("a", "2026-09-17T18:04:00.000Z", { bot_name: null }));
    expect(await feed.poll()).toBe(2);
    expect(sent).toEqual([formatPostedNote(rows[2]!), formatPostedNote(rows[1]!)]);
    expect(sent[0]).toBe("New note\nOn https://x.com/i/status/ta\n\nNote a https://example.org/a\n\nhttps://x.com/i/communitynotes/a");
    expect(sent[1]).toStartWith("New note · simple-bot\n");
    // Same timestamp as the cursor: the id list stops a repeat, a new note still posts.
    rows.push(note("c", "2026-09-17T18:05:00.000Z"));
    expect(await feed.poll()).toBe(1);
    expect(sent).toHaveLength(3);
    expect(await feed.poll()).toBe(0);
    expect(feed.cursor()).toBe("2026-09-17T18:05:00.000Z");
  });

  test("a failed send keeps the cursor so the note is retried, and errors are reported", async () => {
    const store = new SignalStore(":memory:", "feed-test");
    cleanups.push(() => store.close());
    const rows = [note("x", "2026-09-17T18:10:00.000Z"), note("y", "2026-09-17T18:11:00.000Z")];
    const sent: string[] = [];
    const errors: unknown[] = [];
    let fail = true;
    const feed = new NotesFeed({
      store, now: () => new Date("2026-09-17T18:00:00.000Z"),
      listNotesSince: async (since) => rows.filter((row) => row.submitted_at >= since),
      send: async (text) => { if (fail && text.includes("/ty")) throw new Error("Signal down"); sent.push(text); },
      onError: (error) => errors.push(error),
    });
    expect(await feed.poll()).toBe(1);
    expect(errors).toHaveLength(1);
    expect(feed.cursor()).toBe("2026-09-17T18:10:00.000Z");
    fail = false;
    expect(await feed.poll()).toBe(1);
    expect(sent.map((text) => text.split("\n")[1])).toEqual(["On https://x.com/i/status/tx", "On https://x.com/i/status/ty"]);
  });
});
