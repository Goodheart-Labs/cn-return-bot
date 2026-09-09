import { describe, expect, it } from "bun:test";
import { parseSubtitleToCues } from "./ytDlpDownload";

/** A German uploader track. It opens with a style block, which is what made the
 *  parser read three lines of CSS as the video's first words. */
const STYLED_VTT = `WEBVTT
Kind: captions
Language: de

Style:
::cue(c.cyan) { color: cyan; }
::cue(c.yellow) { color: yellow; }
##

00:00:00.040 --> 00:00:01.440 line:95%
<c.yellow> Sommer 2024. </c>

00:00:01.560 --> 00:00:04.080 line:95%
<c.yellow> In Leipzig, in Birmingham
 und in der N&#228;he von Warschau &amp; Krakau </c>
`;

const SRT = `1
00:00:02,000 --> 00:00:04,000
First line

2
00:00:04,000 --> 00:00:06,000
Second line
`;

describe("parseSubtitleToCues", () => {
  it("throws away everything above the first timing line", () => {
    expect(parseSubtitleToCues(STYLED_VTT)).toEqual([
      { start: 0.04, end: 1.44, text: "Sommer 2024." },
      { start: 1.56, end: 4.08, text: "In Leipzig, in Birmingham" },
      { start: 1.56, end: 4.08, text: "und in der Nähe von Warschau & Krakau" },
    ]);
  });

  it("reads SRT, whose cue numbers are not text", () => {
    expect(parseSubtitleToCues(SRT)).toEqual([
      { start: 2, end: 4, text: "First line" },
      { start: 4, end: 6, text: "Second line" },
    ]);
  });
});
