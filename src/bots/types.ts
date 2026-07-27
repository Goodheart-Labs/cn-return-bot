/**
 * Bot Types
 *
 * Defines the interface that all bots must implement.
 */

import type { EvaluatedSource } from "../pipeline/prompts/verify/citations";

export interface PipelineResult {
  post: any;
  botId: string;
  searchContextResult: {
    text: string;
    searchResults: string;
    citations?: string[];
    quotedPostContext?: string;
  };
  noteResult: {
    note: string;
    url: string;
    status: string;
  };
  /** Per-source snippets + explanation for the note's accepted sources. Set only
   *  when the source verifier ran with verifier_citations on. */
  sourceEvaluations?: EvaluatedSource[];
  checkResult?: string;
}

export type PipelineOutcome =
  | { type: "note"; noteText: string; sources: string[]; evalScore?: number; searchResults?: string; sourceEvaluations?: EvaluatedSource[] }
  | { type: "no_correction"; reason: string }
  | { type: "verification_failed"; noteText: string; sources: string[]; reason: string; searchResults?: string };

export function outcomeToResult(
  post: any,
  botId: string,
  outcome: PipelineOutcome,
): PipelineResult {
  const base = {
    post,
    botId,
    searchContextResult: { text: "", searchResults: "" },
    noteResult: { note: "", url: "", status: "NO MISSING CONTEXT" },
  };
  switch (outcome.type) {
    case "note":
      return {
        ...base,
        noteResult: { note: outcome.noteText, url: outcome.sources.join(" "), status: "CORRECTION WITH TRUSTWORTHY CITATION" },
        searchContextResult: {
          ...base.searchContextResult,
          searchResults: outcome.searchResults ?? "",
          citations: outcome.sources,
        },
        sourceEvaluations: outcome.sourceEvaluations,
        checkResult: "YES",
      };
    case "verification_failed":
      return {
        ...base,
        noteResult: { note: outcome.noteText, url: outcome.sources.join(" "), status: "CORRECTION WITH TRUSTWORTHY CITATION" },
        searchContextResult: {
          ...base.searchContextResult,
          searchResults: outcome.searchResults ?? "",
          citations: outcome.sources,
        },
        checkResult: `NO: ${outcome.reason}`,
      };
    case "no_correction":
      return base;
  }
}

export interface MediaItem {
  type: string;
  url?: string;
  preview_image_url?: string;
  variants?: Array<{ bit_rate?: number; content_type: string; url: string }>;
  duration_ms?: number;
}

export interface PostContent {
  text: string;
  /** Image/preview URLs for passing to LLM vision (backward compat) */
  media: string[];
  /** Full media objects with type, variants, etc. for media analysis */
  mediaItems?: MediaItem[];
  quotedPostContext?: string;
  isQuoteTweet: boolean;
}

export interface Bot {
  /** Unique identifier for the bot */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what makes this bot different */
  description: string;

  /** Run the full pipeline for a post */
  runPipeline(post: any, content: PostContent): Promise<PipelineResult | null>;
}
