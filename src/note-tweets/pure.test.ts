import { describe, expect, test } from "bun:test";
import { parseResults } from "./parseResults";
import { rankNotes } from "./ranking";
import { tweetText } from "./tweetText";
import { noteText } from "./markup";
import type { FeedNote, Note } from "./types";

const feedNote: FeedNote = {
  id: "note", slug: "creator", project: "Creator", host: "example.com",
  title: "An article", quote: "The claim.", note: "The context. https://source.example",
  url: "https://commonnotes.net/?project=creator&note=note",
  helpful: 2, published_at: null, updated_quote: null, jim: null,
};

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id, note: "Context", author_id: null, helpful_count: 0, somewhat_helpful_count: 0,
    not_helpful_count: 0, sources: [], created_at: "2026-09-22", everything_claims: null,
    ...overrides,
  };
}

describe("tweet text", () => {
  test("preserves Nathan's wording, spacing, source links and helpful count", () => {
    expect(tweetText(feedNote, { creator: "CreatorHandle" })).toBe(
      'Claim, from @CreatorHandle: "The claim."\n\n' +
      'Additional context: "The context. https://source.example"\n\n' +
      '2 people found this helpful.\n\n' +
      'Link to note: https://commonnotes.net/?project=creator&note=note',
    );
  });

  test("prefers a host handle, includes corrections, and uses singular person", () => {
    const text = tweetText({ ...feedNote, helpful: 1, updated_quote: "Corrected claim." }, {
      "example.com": "Host", creator: "Creator",
    });
    expect(text).toStartWith('Claim, from @Host:');
    expect(text).toContain('\n\nUpdate: the source has since been corrected and now reads "Corrected claim."\n\n1 person found this helpful.');
  });

  test("credits ACX contest entries to the reader and names the host", () => {
    const d = { ...feedNote, title: "Your Book Review: A Book" };
    expect(tweetText(d, { creator: "slatestarcodex" })).toStartWith(
      'Claim, from a reader\'s entry in the ACX book review contest (hosted by @slatestarcodex):',
    );
    expect(tweetText(d, {})).toStartWith('Claim, from a reader\'s entry in the ACX book review contest:');
  });

  test("flags missing handles and omits zero-vote endorsements", () => {
    const text = tweetText({ ...feedNote, helpful: 0 }, {});
    expect(text).toStartWith('Claim, from @??? (Creator):');
    expect(text).not.toContain("found this helpful");
    expect(text).not.toContain("Update:");
  });

  test("appends distinct source URLs in source order", () => {
    expect(noteText(note("a", { sources: [
      { url: "https://second.example", sort_order: 2 },
      { url: "https://first.example", sort_order: 0 },
      { url: "https://first.example", sort_order: 1 },
    ] }))).toBe("Context https://first.example https://second.example");
  });
});

describe("Jim's RESULTS.md parser", () => {
  test("merges buckets, comments, rewordings and hand-picked table entries", () => {
    const first = "11111111-1111-1111-1111-111111111111";
    const second = "22222222-2222-2222-2222-222222222222";
    const third = "33333333-3333-3333-3333-333333333333";
    const jim = parseResults(`## 1. Confident
- Link: https://commonnotes.net/?note=${first}
- Jim: Send the rewording.
**Send instead:** Better wording.
## 2. Uncertain
- Jim: Must not overwrite the previous note.
- Link: https://commonnotes.net/?note=${second}
## 3. Hand-picked
| Note | Pick |
| [First](https://commonnotes.net/?note=${first}) | good |
| [Third](https://commonnotes.net/?note=${third}) | maybe |
## 4. Other
- Link: https://commonnotes.net/?note=44444444-4444-4444-4444-444444444444
`);
    expect([...jim.entries()]).toEqual([
      [first, { bucket: "send", comment: "Send the rewording.", sendInstead: "Better wording.", pick: "good" }],
      [second, { bucket: "uncertain" }],
      [third, { pick: "maybe" }],
    ]);
  });

  test("ignores links outside the list and malformed note IDs", () => {
    expect(parseResults("- Link: https://commonnotes.net/?note=invalid\n## 1. Confident\n- Link: ?note=short").size).toBe(0);
  });
});

describe("ranking", () => {
  test("sorts by probability, discounts the author's vote, then breaks ties by total votes", () => {
    const input = [
      note("unhelpful", { not_helpful_count: 2 }),
      note("helpful", { helpful_count: 3 }),
      note("author", { helpful_count: 4, author_id: "author" }),
      note("somewhat", { somewhat_helpful_count: 4 }),
      note("unrated"),
      note("author-only", { helpful_count: 1, author_id: "author" }),
    ];
    const ranked = rankNotes(input);
    expect(ranked.map(n => n.id)).toEqual(["author", "helpful", "somewhat", "author-only", "unrated", "unhelpful"]);
    expect(ranked.map(n => n.status)).toEqual(["helpful", "helpful", "needs_ratings", "needs_ratings", "needs_ratings", "not_helpful"]);
    expect(ranked[0]!.p).toBeCloseTo(0.85, 1);
    expect(ranked[0]!.p).toBe(ranked[1]!.p);
    expect(input[0]!.id).toBe("unhelpful");
  });

  test("keeps input order on exact ties", () => {
    expect(rankNotes([note("b"), note("a")]).map(n => n.id)).toEqual(["b", "a"]);
  });
});
