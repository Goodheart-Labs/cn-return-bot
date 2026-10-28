import { describe, expect, test } from "bun:test";
import { parsePostedLog, toCandidate, type Judgement } from "./candidates";

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

const judged = (pHelpful: number, pImpactful: number, judgedAt = "2026-10-11T00:00:00Z"): Judgement => ({ pHelpful, pImpactful, reasoning: "", judgedAt });

const IMPORTANT = "https://thezvi.substack.com";

const candidate = (params: { note: ReturnType<typeof note>; votes?: ReturnType<typeof vote>[]; postedAt?: string | null; judge?: Judgement | null }) =>
  toCandidate({ votes: [], sources: [], minisiteSlug: null, teamIds: new Set([TEAM_MEMBER]), since: SINCE, postedAt: null, judge: null, ...params });

describe("toCandidate", () => {
  test("an old AI note without new votes is no candidate", () => {
    expect(candidate({ note: note() })).toBeNull();
  });

  test("the author's own Helpful vote does not count", () => {
    expect(candidate({ note: note({ author_id: AUTHOR, created_at: "2026-10-01T00:00:00Z" }), votes: [vote(AUTHOR, 1, "2026-10-11T00:00:00Z")] })).toBeNull();
  });

  test("new Helpful votes on an important creator are counted, and the team's are marked", () => {
    const result = candidate({ note: note({ feed_url: IMPORTANT }), votes: [vote("a", 1, "2026-10-11T00:00:00Z"), vote(TEAM_MEMBER, 0, "2026-10-12T00:00:00Z")] });
    expect(result?.reasons).toEqual([{ type: "helpful_votes", helpful: 1, somewhatHelpful: 1, fromTeam: 1 }]);
  });

  test("a Helpful vote elsewhere needs a decent chance of the leaderboard", () => {
    const votes = [vote("a", 1, "2026-10-11T00:00:00Z")];
    expect(candidate({ note: note(), votes })).toBeNull();
    expect(candidate({ note: note(), votes, judge: judged(0.4, 0.1) })).toBeNull();
    expect(candidate({ note: note(), votes, judge: judged(0.4, 0.3) })?.reasons.map((reason) => reason.type)).toEqual(["helpful_votes"]);
  });

  test("only Somewhat helpful votes do not make a note promising", () => {
    expect(candidate({ note: note({ feed_url: IMPORTANT }), votes: [vote("a", 0, "2026-10-11T00:00:00Z")] })).toBeNull();
  });

  test("a note the judge expects to be rated helpful is a candidate on an important creator or with a decent chance of the leaderboard", () => {
    expect(candidate({ note: note({ feed_url: IMPORTANT }), judge: judged(0.8, 0.05) })?.reasons).toEqual([{ type: "judged_promising", pHelpful: 0.8 }]);
    expect(candidate({ note: note(), judge: judged(0.8, 0.3) })?.judge?.pImpactful).toBe(0.3);
    expect(candidate({ note: note(), judge: judged(0.8, 0.1) })).toBeNull();
    expect(candidate({ note: note({ feed_url: IMPORTANT }), judge: judged(0.6, 0.9) })).toBeNull();
  });

  test("a judgement from before the window does not bring a note back", () => {
    expect(candidate({ note: note({ feed_url: IMPORTANT }), judge: judged(0.9, 0.9, "2026-10-01T00:00:00Z") })).toBeNull();
  });

  test("a note rated helpful is a candidate wherever it is", () => {
    const votes = ["a", "b", "c", "d", "e"].map((voter) => vote(voter, 1, "2026-10-11T00:00:00Z"));
    expect(candidate({ note: note({ helpful_count: 5 }), votes })?.reasons.map((reason) => reason.type)).toContain("rated_helpful");
  });

  test("a note posted before comes back only for votes after the post", () => {
    const votes = [vote("a", 1, "2026-10-11T00:00:00Z")];
    expect(candidate({ note: note({ feed_url: IMPORTANT }), votes, postedAt: "2026-10-12T00:00:00Z" })).toBeNull();
    expect(candidate({ note: note({ feed_url: IMPORTANT }), votes: [...votes, vote("b", 1, "2026-10-13T00:00:00Z")], postedAt: "2026-10-12T00:00:00Z" })?.postedAt).toBe(
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
