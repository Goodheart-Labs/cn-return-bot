import { describe, expect, it } from "bun:test";
import { parseSubtitleListing } from "./ytDlpDownload";

/** Trimmed from a real `yt-dlp --list-subs` run on a German video. The hundreds
 *  of translations all read "<Language> from German", and the two rows that are
 *  not translations are the automatic German captions and the German track the
 *  uploader supplied. */
const GERMAN_VIDEO = `[youtube] Extracting URL: https://www.youtube.com/watch?v=p8iwsg64rjs
[youtube] p8iwsg64rjs: Downloading webpage
[info] Available automatic captions for p8iwsg64rjs:
Language               Name                                   Formats
de                                                            vtt
ab-de-XwLwiJMB_Xs      Abkhazian from German - de             vtt, srt, ttml, srv3, srv2, srv1, json3
en-de-XwLwiJMB_Xs      English from German - de               vtt, srt, ttml, srv3, srv2, srv1, json3
[info] Available subtitles for p8iwsg64rjs:
Language       Name        Formats
de-XwLwiJMB_Xs German - de vtt, srt, ttml, srv3, srv2, srv1, json3
`;

/** The same listing for an English video. Here YouTube names the translations
 *  with plain codes and marks the original `en-orig`, which is why a language
 *  code on its own never says whether a track is a translation. */
const ENGLISH_VIDEO = `[info] Available automatic captions for dQw4w9WgXcQ:
Language Name                 Formats
en-orig  English (Original)   vtt, srt
ab       Abkhazian from English vtt, srt
de       German from English  vtt, srt
[info] Available subtitles for dQw4w9WgXcQ:
Language Name              Formats
en       English           vtt, srt
ja       Japanese          vtt, srt
`;

describe("parseSubtitleListing", () => {
  it("keeps the video's own tracks and drops every translation", () => {
    expect(parseSubtitleListing(GERMAN_VIDEO)).toEqual(["de-XwLwiJMB_Xs", "de"]);
  });

  it("puts the uploader's tracks before the automatic ones", () => {
    expect(parseSubtitleListing(ENGLISH_VIDEO)).toEqual(["en", "ja", "en-orig"]);
  });

  it("answers with nothing when the video has no captions", () => {
    expect(parseSubtitleListing("[youtube] abc: Downloading webpage\n")).toEqual([]);
  });
});
