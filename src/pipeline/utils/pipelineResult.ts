/**
 * Pipeline Result Builders
 *
 * Shared constructors for PipelineResult used by both single-agent and multi-agent pipelines.
 */

import type { PipelineResult } from "../../bots/types";

export function buildNoteResult(params: {
  post: any;
  botId: string;
  lastStage: string;
  text: string;
  searchResults: string;
  noteText: string;
  sources: string[];
  allUrls: string;
  warnings?: string[];
}): PipelineResult {
  return {
    post: params.post,
    botId: params.botId,
    lastStage: params.lastStage,
    searchContextResult: { text: params.text, searchResults: params.searchResults, citations: params.sources },
    noteResult: { note: params.noteText, url: params.allUrls, status: "CORRECTION WITH TRUSTWORTHY CITATION" },
    checkResult: "YES",
    warnings: params.warnings,
  };
}

export function buildEmptyResult(params: {
  post: any;
  botId: string;
  lastStage: string;
  text: string;
  searchResults: string;
  error?: string;
  warnings?: string[];
}): PipelineResult {
  return {
    post: params.post,
    botId: params.botId,
    lastStage: params.lastStage,
    searchContextResult: { text: params.text, searchResults: params.searchResults, citations: [] },
    noteResult: { note: "", url: "", status: params.error ? "ERROR" : "NO MISSING CONTEXT" },
    error: params.error,
    warnings: params.warnings,
  };
}
