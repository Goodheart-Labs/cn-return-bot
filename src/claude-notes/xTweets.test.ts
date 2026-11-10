import { describe, expect, test } from "bun:test";
import { tweetsToStart, type XTweet, xNoteProblems } from "./xTweets";

describe("xNoteProblems", () => {
  test("accepts a note within the limit that has a link", () => {
    expect(xNoteProblems(`${"a".repeat(270)} https://example.com/a-very-long-path-that-counts-as-one`)).toEqual([]);
  });

  test("counts each link as one character", () => {
    expect(xNoteProblems(`${"a".repeat(279)} https://example.com`)).toHaveLength(1);
  });

  test("requires a link", () => {
    expect(xNoteProblems("The photo is from 2019.")).toEqual(["The note has no link. X requires at least one source link."]);
  });
});

describe("tweetsToStart", () => {
  const now = new Date("2026-11-10T11:21:00Z");
  const tweet = (runId: string, minutesOld: number): XTweet => ({
    runId,
    tweetId: runId,
    createdAt: new Date(now.getTime() - minutesOld * 60_000).toISOString(),
    stage: "claude_waiting",
    input: "",
    picks: {},
  });

  test("skips tweets the X run would sweep before a Claude can answer", () => {
    expect(tweetsToStart([tweet("old", 207), tweet("almost", 155), tweet("fresh", 10)], now).map((t) => t.runId)).toEqual(["fresh"]);
  });

  test("starts the newest tweets first", () => {
    expect(tweetsToStart([tweet("a", 90), tweet("b", 5), tweet("c", 40)], now).map((t) => t.runId)).toEqual(["b", "c", "a"]);
  });
});
