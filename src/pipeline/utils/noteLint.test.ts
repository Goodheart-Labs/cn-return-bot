import { test, expect } from "bun:test";
import { lintWriterNote, topicSourcelessRejection, MAX_TOPIC_SOURCES } from "./noteLint";
import { withMonitoringContext } from "../misinfo-monitoring/monitoringContext";

const MAX = 280;
const URL_A = "https://www.senate.gov/legislative/votes.htm";
const URL_B = "https://www.sos.ks.gov/elections/election-faq.html";

function lint(noteText: string, sources: string[], topicRules: boolean) {
  return lintWriterNote({ noteText, sources, maxChars: MAX, topicRules });
}

// ── Length rule (both modes — regular-pipeline behavior unchanged) ──────────

test("short note with sources passes in both modes", () => {
  const note = "The Senate rejected the amendment 48-50 on June 5, 2026.";
  expect(lint(note, [URL_A], false).problems).toHaveLength(0);
  expect(lint(note, [URL_A], true).problems).toHaveLength(0);
});

test("overlong note fails the length rule in both modes; URLs count as 1 char", () => {
  const body = "x".repeat(279); // 279 + space + 1-char URL = 281
  for (const topicRules of [false, true]) {
    const { charCount, problems } = lint(body, [URL_A], topicRules);
    expect(charCount).toBe(281);
    expect(problems.map((p) => p.kind)).toEqual(["length"]);
  }
});

test("empty note (no dispute found) is never linted", () => {
  for (const topicRules of [false, true]) {
    const { charCount, problems } = lint("", [], topicRules);
    expect(charCount).toBe(0);
    expect(problems).toHaveLength(0);
  }
});

// ── Topic-only rules stay off for regular notes ─────────────────────────────

test("regular mode ignores source count, URL form, and bare domains", () => {
  const { problems } = lint(
    "See foxnews.com/politics/some-story for details.",
    [URL_A, URL_B, "https://example.com/a", "www.example.com/b"],
    false,
  );
  expect(problems).toHaveLength(0);
});

// ── Topic rules ─────────────────────────────────────────────────────────────

test(`topic notes cite at most ${MAX_TOPIC_SOURCES} sources`, () => {
  const { problems } = lint("Short correction.", [URL_A, URL_B, "https://example.com/c"], true);
  expect(problems.map((p) => p.kind)).toEqual(["source_count"]);
});

test("topic sources must be full https:// URLs", () => {
  const cases = ["www.example.com/story", "foxnews.com/politics", "http://example.com/x", "not a url"];
  for (const bad of cases) {
    const { problems } = lint("Short correction.", [bad], true);
    expect(problems.map((p) => p.kind)).toEqual(["source_url"]);
  }
});

test("topic note body must not cite bare domains (the N5 shape)", () => {
  const { problems } = lint(
    'Per whitehouse.gov/election-integrity/ "Noncitizens on State Voter Rolls" the figure is unverified.',
    [URL_A],
    true,
  );
  expect(problems.map((p) => p.kind)).toEqual(["bare_domain"]);
  expect(problems[0]!.message).toContain("whitehouse.gov/election-integrity/");
});

test("full https URLs in the body are not flagged as bare domains", () => {
  const { problems } = lint(
    `The vote is recorded at ${URL_A} for anyone to check.`,
    [URL_B],
    true,
  );
  expect(problems).toHaveLength(0);
});

test("prose mentioning an outlet name without a path is not flagged", () => {
  const { problems } = lint(
    "The FactCheck.org article does not support the claim. Sentence continues.News reports vary.",
    [URL_A],
    true,
  );
  expect(problems).toHaveLength(0);
});

test("multiple problems are all reported", () => {
  const body = "x".repeat(280) + " see foxnews.com/politics/story";
  const { problems } = lint(body, [URL_A, URL_B, "www.bad.com/x"], true);
  const kinds = problems.map((p) => p.kind).sort();
  expect(kinds).toEqual(["bare_domain", "length", "source_count", "source_url"]);
});

// ── Post-verification sourceless guard ──────────────────────────────────────

const CTX = { topicId: "trump_election_security", topicTitle: "t", document: "doc" } as never;

test("sourceless guard fires only for topic notes with zero good sources", async () => {
  // Outside a monitoring context: never fires.
  expect(topicSourcelessRejection([])).toBeNull();
  expect(topicSourcelessRejection([URL_A])).toBeNull();
  // Inside: fires exactly when good_sources is empty.
  await withMonitoringContext(CTX, async () => {
    expect(topicSourcelessRejection([URL_A])).toBeNull();
    expect(topicSourcelessRejection([])).toContain("no verified sources");
  });
});
