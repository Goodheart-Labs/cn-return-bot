import { describe, expect, test } from "bun:test";
import { parsePostedLog, toCandidate } from "./candidates";

const SINCE = "2026-10-10T00:00:00Z";
const AUTHOR = "author";
const TEAM_MEMBER = "team";

function note(overrides: { created_at?: string; author_id?: string | null; helpful_count?: number; feed_url?: string } = {}) {
  return {
    id: "n1",
    note: "The figure is wrong.",
    created_at: overrides.created_at ?? "2026-10-01T00:00:00Z",
    author_id: overrides.author_id ?? null,
    author_name: overrides.author_id ? "Reader" : null,
    improved_from_note_id: null,
    helpful_count: overrides.helpful_count ?? 0,
    somewhat_helpful_count: 0,
    not_helpful_count: 0,
    claim: {
      claim: "A claim",
      judgement: "likely false",
      context_quote: "A passage",
      context_paragraph: null,
      image_urls: null,
      item: { id: "i1", title: "A post", url: "https://example.com/p", project: { slug: "x", name: "X", feed_url: overrides.feed_url ?? "https://x.substack.com" } },
    },
  };
}

const vote = (voter_id: string, vote: -1 | 0 | 1, updated_at: string) => ({ id: `${voter_id}${updated_at}`, note_id: "n1", voter_id, vote, updated_at });

const candidate = (params: { note: ReturnType<typeof note>; votes?: ReturnType<typeof vote>[]; postedAt?: string | null }) =>
  toCandidate({ votes: [], sources: [], minisiteSlug: null, teamIds: new Set([TEAM_MEMBER]), since: SINCE, postedAt: null, ...params });

describe("toCandidate", () => {
  test("an old AI note without new votes is no candidate", () => {
    expect(candidate({ note: note() })).toBeNull();
  });

  test("the author's own Helpful vote does not count", () => {
    expect(candidate({ note: note({ author_id: AUTHOR, created_at: "2026-10-01T00:00:00Z" }), votes: [vote(AUTHOR, 1, "2026-10-11T00:00:00Z")] })).toBeNull();
  });

  test("new Helpful votes are counted and the team's are marked", () => {
    const result = candidate({ note: note(), votes: [vote("a", 1, "2026-10-11T00:00:00Z"), vote(TEAM_MEMBER, 0, "2026-10-12T00:00:00Z")] });
    expect(result?.reasons).toEqual([{ type: "helpful_votes", helpful: 1, somewhatHelpful: 1, fromTeam: 1 }]);
  });

  test("a new note by a person on an important creator has both reasons", () => {
    const result = candidate({ note: note({ author_id: AUTHOR, created_at: "2026-10-11T00:00:00Z", feed_url: "https://thezvi.substack.com" }) });
    expect(result?.reasons.map((reason) => reason.type)).toEqual(["written_by_person", "important_creator"]);
  });

  test("a note posted before comes back only for votes after the post", () => {
    const votes = [vote("a", 1, "2026-10-11T00:00:00Z")];
    expect(candidate({ note: note(), votes, postedAt: "2026-10-12T00:00:00Z" })).toBeNull();
    expect(candidate({ note: note(), votes: [...votes, vote("b", 1, "2026-10-13T00:00:00Z")], postedAt: "2026-10-12T00:00:00Z" })?.postedAt).toBe(
      "2026-10-12T00:00:00Z",
    );
  });
});

describe("parsePostedLog", () => {
  test("reads one note id and time per line and skips blank lines", () => {
    expect(parsePostedLog("n1 2026-10-12T00:00:00Z\n\nn2 2026-10-13T00:00:00Z\n")).toEqual(
      new Map([
        ["n1", "2026-10-12T00:00:00Z"],
        ["n2", "2026-10-13T00:00:00Z"],
      ]),
    );
  });
});
