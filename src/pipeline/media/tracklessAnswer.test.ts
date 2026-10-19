import { describe, expect, test } from "bun:test";
import { readTracklessAnswer } from "./youtubeCaptions";

describe("readTracklessAnswer", () => {
  test("an age-restricted video is a fact about the video, not a failure to reach YouTube", () => {
    const stderr = "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.";
    expect(readTracklessAnswer(stderr)).toEqual({ kind: "age_restricted" });
  });

  test("YouTube's bot check, with either apostrophe, means YouTube was not reached", () => {
    for (const apostrophe of ["'", "’"]) {
      const stderr = `ERROR: [youtube] abc: Sign in to confirm you${apostrophe}re not a bot. Use --cookies-from-browser`;
      expect(readTracklessAnswer(stderr).kind).toBe("unreachable");
    }
  });

  test("a rate limit means YouTube was not reached", () => {
    expect(readTracklessAnswer("WARNING: unrelated\nERROR: HTTP Error 429: Too Many Requests")).toEqual({
      kind: "unreachable",
      line: "ERROR: HTTP Error 429: Too Many Requests",
    });
  });

  test("no complaint at all means the video has no captions", () => {
    expect(readTracklessAnswer("")).toEqual({ kind: "none" });
  });
});
