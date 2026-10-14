import type { SubtitleCue } from "../pipeline/media/youtubeCaptions";

export type SourceKind = "youtube" | "substack" | "lesswrong";

/** Everything an item row's source column can hold. `web` is an arbitrary page:
 *  either one a reader wrote the first note on, or one a reader requested notes
 *  on. Such an item is processed from the body text stored on it when the
 *  request captured one, and fetched through the web-fetch ladder otherwise. */
export type ItemSource = SourceKind | "web";

/** Content fetched from a source, ready for claim extraction. `authorName` is
 *  the source's human-readable name, so the YouTube channel name or the
 *  Substack publication name. The worker uses it to fill in the display name
 *  of a project that was created knowing only its slug. */
export type FetchedContent =
  | { kind: "youtube"; url: string; videoId: string; title: string; publishedAt?: string; cues: SubtitleCue[]; authorName?: string }
  | { kind: "substack"; url: string; title: string; publishedAt?: string; text: string; authorName?: string }
  // A YouTube video whose claims come from a transcript the caller supplied.
  // That is usually the author's own clean published transcript. Timestamps are
  // still snapped against the video's own cues, so anchoring works exactly as
  // it does for `youtube`.
  | {
      kind: "youtube-transcript";
      url: string;
      videoId: string;
      title: string;
      publishedAt?: string;
      text: string;
      cues: SubtitleCue[];
      authorName?: string;
    };

/** Where a claim's context lives in the original content. */
export type ClaimAnchor =
  | { kind: "youtube"; startSeconds?: number; endSeconds?: number; deepLinkUrl?: string }
  | { kind: "substack"; url: string };

export interface ExtractedClaim {
  steer?: string | null;
  /** What is checked: the point as the author wrote it. For a point that is an
   *  image, the description of the image and the text visible in it. */
  claim: string;
  /** The point, word for word, which is the quote the claim is anchored by.
   *  Empty for a point that is an image. */
  context: string;
  /** Article images the claim is grounded in. Only Substack articles supply
   *  these. A claim can rest on text, on images, or on both. */
  imageUrls: string[];
  anchor: ClaimAnchor;
}

/** One topic part of an item, as the gate and split step cut it, with the
 *  claims extracted from it. `text` is the part's body in the form the item's
 *  full_text is stored in: raw article text with its [[IMAGE:url]] markers, or
 *  the part's subtitle cues joined with newlines. The rater reads it. */
export interface ContentPart {
  index: number;
  title: string;
  text: string;
  claims: ExtractedClaim[];
}

/** What extraction makes of an item. Either the gate declined it, with the
 *  model's reason, or the item was cut into parts and each part's claims were
 *  extracted. `introduction` is the text before the first part, which the
 *  rater shows ahead of each part as context. When it is set, the first part
 *  is the introduction itself, so its own claims are extracted once and it is
 *  never shown its own text as context. An item the model chose not to split
 *  is one part with no introduction. */
export type ExtractionResult =
  | { kind: "not_checkable"; reason: string }
  | { kind: "claims"; introduction: string | null; parts: ContentPart[] };

/** An extracted claim after the rating step. `judgement` is how true the
 *  rater thinks the claim is, one of seven levels from "certainly true" to
 *  "certainly false", judged with web research in hand. It decides whether the
 *  claim is fact-checked. */
export interface RatedClaim extends ExtractedClaim {
  judgement: string;
}

/** One cited source of a note. It carries the verbatim passage that supports the
 *  note, when the verifier managed to extract one, and a plain-language
 *  explanation of why the source supports it. */
export interface NoteSourceCitation {
  url: string;
  quote: string | null;
  explanation: string | null;
}

/** Outcome of running one claim through the note pipeline. A claim that was
 *  skipped because the rater is confident it is true never reaches the pipeline, and
 *  neither does a claim that errored. The worker records those two outcomes
 *  directly on the claim row instead. */
export type ClaimCheck =
  | { kind: "no_note"; outcome: string; reason: string | null }
  | { kind: "note"; note: string; sources: NoteSourceCitation[] };
