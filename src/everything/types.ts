import type { SubtitleCue } from "../pipeline/media/ytDlpDownload";

export type SourceKind = "youtube" | "substack";

/** Everything an item row's source column can hold. `web` is an arbitrary page:
 *  either one a reader wrote the first note on, or one a reader requested notes
 *  on. Such an item is processed from the body text stored on it, because the
 *  pipeline cannot fetch arbitrary pages from CI. */
export type ItemSource = SourceKind | "web";

/** Content fetched from a source, ready for claim extraction. */
export type FetchedContent =
  | { kind: "youtube"; url: string; videoId: string; title: string; publishedAt?: string; cues: SubtitleCue[] }
  | { kind: "substack"; url: string; title: string; publishedAt?: string; text: string }
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
    };

/** Where a claim's context lives in the original content. */
export type ClaimAnchor =
  | { kind: "youtube"; startSeconds?: number; endSeconds?: number; deepLinkUrl?: string }
  | { kind: "substack"; url: string };

export interface ExtractedClaim {
  /** Neutral, self-contained restatement of the claim. */
  claim: string;
  /** How true Opus thinks the claim is, judged from its own knowledge alone.
   *  It is one of seven levels, from "certainly true" to "certainly false". */
  judgement: string;
  /** Verbatim excerpt with all the context needed to evaluate the claim.
   *  Empty for an image-only claim that carries no supporting text. */
  context: string;
  /** Wider verbatim excerpt, usually the paragraph or paragraphs around the
   *  claim. It contains `context` word for word. Readers see it as the passage
   *  the claim sits in. It is empty when the claim rests only on an image and
   *  has no surrounding text. */
  contextParagraph: string;
  /** Article images the claim is grounded in. Only Substack articles supply
   *  these. A claim can rest on text, on images, or on both. */
  imageUrls: string[];
  /** True when the claim describes a hypothetical or future scenario rather
   *  than the present or the past. Such claims are filtered out before
   *  fact-checking. */
  speculation: boolean;
  anchor: ClaimAnchor;
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
 *  skipped because Opus is confident it is true never reaches the pipeline, and
 *  neither does a claim that errored. The worker records those two outcomes
 *  directly on the claim row instead. */
export type ClaimCheck =
  | { kind: "no_note"; outcome: string; reason: string | null }
  | { kind: "note"; note: string; sources: NoteSourceCitation[] };
