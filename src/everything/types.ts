import type { SubtitleCue } from "../pipeline/media/ytDlpDownload";

export type SourceKind = "youtube" | "substack";

/** Content fetched from a source, ready for claim extraction. */
export type FetchedContent =
  | { kind: "youtube"; url: string; videoId: string; title: string; publishedAt?: string; cues: SubtitleCue[] }
  | { kind: "substack"; url: string; title: string; publishedAt?: string; text: string }
  // A YouTube video whose claims are extracted from a caller-supplied transcript
  // (e.g. an author's clean published transcript) but whose timestamps are still
  // snapped against the video's own cues. Same anchoring as `youtube`.
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
  /** Opus's truth judgement from its own knowledge (7-point scale). */
  judgement: string;
  /** Verbatim excerpt with all the context needed to evaluate the claim.
   *  Empty for an image-only claim that carries no supporting text. */
  context: string;
  /** Wider verbatim excerpt (surrounding paragraph[s]) containing `context`
   *  word-for-word — shown to readers as the passage around the claim. Empty
   *  when the claim has no surrounding text (image-only). */
  contextParagraph: string;
  /** Article images the claim is grounded in (Substack only). A claim can rest
   *  on text, image(s), or both. */
  imageUrls: string[];
  /** True when the claim describes a hypothetical/future scenario rather than
   *  the present or past — these are filtered out before fact-checking. */
  speculation: boolean;
  anchor: ClaimAnchor;
}

/** One cited source of a note, with the verbatim passage that supports it (when
 *  the verifier extracted one) and a plain-language explanation. */
export interface NoteSourceCitation {
  url: string;
  quote: string | null;
  explanation: string | null;
}

/** Outcome of running one claim through the note pipeline. (Claims skipped as
 *  confident-true or erroring never reach the pipeline — the worker records
 *  those directly on the claim row.) */
export type ClaimCheck =
  | { kind: "no_note"; outcome: string; reason: string | null }
  | { kind: "note"; note: string; sources: NoteSourceCitation[] };
