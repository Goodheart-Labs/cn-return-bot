/**
 * Bot Types
 *
 * Defines the interface that all bots must implement.
 */

import type { AllNoteScores } from "../pipeline/score/noteScores";

export interface PipelineResult {
  post: any;
  botId: string;
  /** Last stage the bot successfully completed */
  lastStage: string;
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
  checkResult?: string;
  /** Note quality scores pre-computed by the bot (e.g. for filter gating). When
   * present, downstream scoring in processTweet reuses these instead of rerunning. */
  noteScores?: AllNoteScores;
  /** If the bot failed, this contains error info */
  error?: string;
  /** Non-fatal warnings (e.g. media analysis failed but pipeline continued) */
  warnings?: string[];
}

export type PipelineOutcome =
  | { type: "note"; noteText: string; sources: string[]; evalScore?: number; scores?: AllNoteScores }
  | { type: "no_correction"; reason: string }
  | { type: "filtered"; filterName: string; reason: string; noteText: string; sources: string[]; scores: AllNoteScores }
  | { type: "error"; error: string };

export function outcomeToResult(post: any, botId: string, outcome: PipelineOutcome): PipelineResult {
  const base = {
    post,
    botId,
    lastStage: "complete",
    searchContextResult: { text: "", searchResults: "" },
    noteResult: { note: "", url: "", status: "NO MISSING CONTEXT" },
  };
  switch (outcome.type) {
    case "note":
      return {
        ...base,
        noteResult: { note: outcome.noteText, url: outcome.sources.join(" "), status: "CORRECTION WITH TRUSTWORTHY CITATION" },
        searchContextResult: { ...base.searchContextResult, citations: outcome.sources },
        checkResult: "YES",
        noteScores: outcome.scores,
      };
    case "no_correction":
      return base;
    case "filtered":
      return {
        ...base,
        lastStage: "scoring",
        noteResult: { note: outcome.noteText, url: outcome.sources.join(" "), status: "SCORING_FILTERS_FAILED" },
        searchContextResult: { ...base.searchContextResult, citations: outcome.sources },
        checkResult: "YES",
        noteScores: outcome.scores,
      };
    case "error":
      return { ...base, lastStage: "error", noteResult: { ...base.noteResult, status: "ERROR" }, error: outcome.error };
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
