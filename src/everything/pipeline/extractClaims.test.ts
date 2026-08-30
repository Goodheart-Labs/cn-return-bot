import { describe, expect, test } from "bun:test";
import { contextTimeSpan } from "./extractClaims";
import type { SubtitleCue } from "../../pipeline/media/ytDlpDownload";

/** Cues shaped like the passage that surfaced the bug (GOO-52): the video
 *  https://www.youtube.com/watch?v=koKDP6kPvvY had a noted claim whose short
 *  context excerpt straddled a cue boundary, so no whole cue appeared inside
 *  it and the claim was saved without a timestamp. Without a timestamp the
 *  extension never pins the note on the player. */
const cues: SubtitleCue[] = [
  { start: 185, end: 193, text: "And then Dookie came out and Green Day found that perfect balance" },
  { start: 193, end: 198, text: "of having the edge still but being very mass appeal. And within what?" },
  { start: 198, end: 202, text: "3 years? Sum 41? You know? I'm not critiquing Sum 41 in particular," },
  { start: 202, end: 209, text: "but that kind of punk became like so mass appeal and so clean" },
];

describe("contextTimeSpan", () => {
  test("finds a short excerpt that straddles a cue boundary", () => {
    expect(contextTimeSpan("And within what? 3 years? Sum 41?", cues)).toEqual({ start: 193, end: 202 });
  });

  test("finds a short excerpt inside a single cue", () => {
    expect(contextTimeSpan("having the edge still", cues)).toEqual({ start: 193, end: 198 });
  });

  test("finds an excerpt spanning several whole cues", () => {
    const excerpt = cues.slice(0, 3).map((c) => c.text).join(" ");
    expect(contextTimeSpan(excerpt, cues)).toEqual({ start: 185, end: 202 });
  });

  test("ignores punctuation and casing differences", () => {
    expect(contextTimeSpan("and WITHIN what... 3 years — Sum 41", cues)).toEqual({ start: 193, end: 202 });
  });

  test("falls back to whole-cue matching when the excerpt has extra wording", () => {
    // An excerpt from an author's own transcript can contain a whole cue
    // verbatim while its surrounding words differ from the auto-captions.
    const excerpt = "He said: 3 years? Sum 41? You know? I'm not critiquing Sum 41 in particular, right?";
    expect(contextTimeSpan(excerpt, cues)).toEqual({ start: 198, end: 202 });
  });

  test("returns an empty span for text not in the transcript", () => {
    expect(contextTimeSpan("something entirely different was said here", cues)).toEqual({});
  });

  test("returns an empty span for an empty excerpt", () => {
    expect(contextTimeSpan("", cues)).toEqual({});
  });
});
