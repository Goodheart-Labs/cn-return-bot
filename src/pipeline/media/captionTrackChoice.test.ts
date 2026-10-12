import { describe, expect, it } from "bun:test";
import { captionTracksFromDump, chooseCaptionTrack, type CaptionTrack } from "./youtubeCaptions";

const TIMEDTEXT = "https://www.youtube.com/api/timedtext?v=abc&fmt=vtt&pot=token";

/** A track whose file is the video's own: its address names no target language. */
const original = (code: string, kind: CaptionTrack["kind"] = "automatic"): CaptionTrack => ({ code, kind, url: `${TIMEDTEXT}&lang=${code}` });

/** A machine translation: YouTube puts the target language in `tlang`. */
const translated = (code: string): CaptionTrack => ({ code, kind: "automatic", url: `${TIMEDTEXT}&tlang=${code}` });

describe("chooseCaptionTrack", () => {
  // The shapes below are what yt-dlp listed for real videos on 2026-09-30 (GOO-276).

  it("takes the English speech recognition on a dubbed English video, never yt-dlp's plain `en`", () => {
    // CityNews SCbpjgol-Gk: one audio track per dubbed language, and `en` is a translation.
    const tracks = [translated("en"), original("ar-orig"), original("en-orig"), original("ja-orig")];
    expect(chooseCaptionTrack(tracks, "en-US")?.code).toBe("en-orig");
  });

  it("takes an English dub before the video's own language", () => {
    // Mundo Maldini qZ-h-zQwDOQ: a Spanish video with an English dub.
    const tracks = [original("ar-orig"), translated("en"), original("en-US-orig"), original("es-orig")];
    expect(chooseCaptionTrack(tracks, "es")?.code).toBe("en-US-orig");
  });

  it("falls back to the video's own language when English exists only as a translation", () => {
    // ヰ世界情緒 ttVUZOkTxuM.
    expect(chooseCaptionTrack([translated("en"), original("ja-orig")], "ja")?.code).toBe("ja-orig");
  });

  it("picks the spoken language among several dubs, not the first in the list", () => {
    const tracks = [original("ar-orig"), original("bn-orig"), original("es-orig"), translated("en")];
    expect(chooseCaptionTrack(tracks, "es-419")?.code).toBe("es-orig");
  });

  it("prefers a track a person wrote over speech recognition", () => {
    const tracks = [original("en-orig"), original("en-JkeT_87f4cc", "uploaded"), original("en", "uploaded")];
    expect(chooseCaptionTrack(tracks, "en")?.code).toBe("en");
    expect(chooseCaptionTrack(tracks, "en")?.kind).toBe("uploaded");
  });

  it("takes any original track when none is in English or the spoken language", () => {
    // LOLUET o5NRO4E3GzY: a Japanese video whose only original track is uploaded Korean.
    expect(chooseCaptionTrack([original("ko", "uploaded"), translated("en-ko")], "ja")?.code).toBe("ko");
  });

  it("answers null when every track is a translation or there are none", () => {
    expect(chooseCaptionTrack([translated("en"), translated("ab")], "en")).toBeNull();
    expect(chooseCaptionTrack([], null)).toBeNull();
  });
});

describe("captionTracksFromDump", () => {
  it("keeps the WebVTT file of every track, uploaded ones first", () => {
    const dump = {
      automatic_captions: { "en-orig": [{ ext: "json3", url: "a.json3" }, { ext: "vtt", url: "a.vtt" }] },
      subtitles: { en: [{ ext: "srv3", url: "b.srv3" }, { ext: "vtt", url: "b.vtt" }] },
    };
    expect(captionTracksFromDump(dump)).toEqual([
      { code: "en", kind: "uploaded", url: "b.vtt" },
      { code: "en-orig", kind: "automatic", url: "a.vtt" },
    ]);
  });

  it("answers with no tracks when the video has no captions", () => {
    expect(captionTracksFromDump({})).toEqual([]);
  });
});
