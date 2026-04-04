/**
 * Opus Main v2 Bot
 *
 * Primary bot using Claude Opus 4.5 with standard Perplexity search.
 * Uses the unified writeNote pipeline with URL-aware character counting.
 */

import { Bot, PipelineResult } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/search/searchContextGoal";
import { writeNoteFn as writeNote } from "../pipeline/write/writeNote";
import { verifySource } from "../pipeline/verify/sourceVerification";
import { analyzeMedia } from "../pipeline/media/mediaAnalysis";

const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-sonnet-4",
  vision: "anthropic/claude-sonnet-4",
};

export const opusMainV2: Bot = {
  id: "opus-main-v2",
  name: "Opus 4.5 (Main v2)",
  description: "Primary bot using Claude Opus 4.5 with unified note writer",
  weight: 15,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    const warnings: string[] = [];
    try {
      // Media analysis (non-fatal — continues without it but records warning)
      let mediaContext = "";
      if (content.mediaItems?.length) {
        try {
          const mediaResult = await analyzeMedia(content.mediaItems, {
            visionModel: MODELS.vision,
          });
          mediaContext = mediaResult.contextForSearch;
          lastStage = "media_analysis";
          if (mediaResult.warnings.length > 0) {
            warnings.push(...mediaResult.warnings);
          }
        } catch (err: any) {
          const msg = `Media analysis failed: ${err.message}`;
          // If tweet is media-only (no meaningful text), media analysis is essential
          const strippedText = content.text.replace(/@\w+/g, "").replace(/https?:\/\/\S+/g, "").trim();
          if (strippedText.length < 20) {
            throw new Error(`${msg} (fatal: media-only tweet has no text to search with)`);
          }
          console.warn(`[${this.id}] ${msg} (continuing without media context)`);
          warnings.push(msg);
        }
      }

      lastStage = "search";
      const searchResult = await perplexitySearch(
        {
          text: content.text,
          media: content.media,
          mediaContext,
          quotedPostContext: content.quotedPostContext,
        },
        { model: MODELS.search }
      );

      lastStage = "note_writing";
      const noteResult = await writeNote(
        {
          text: searchResult.text,
          searchResults: searchResult.searchResults,
          citations: searchResult.citations || [],
          mediaContext,
        },
        { model: MODELS.noteWriting }
      );

      lastStage = "check";
      const checkResult = await verifySource(
        {
          note: noteResult.note,
          url: noteResult.url,
          status: noteResult.status,
        },
        { model: MODELS.checking }
      );

      return {
        post,
        botId: this.id,
        lastStage,
        searchContextResult: searchResult,
        noteResult,
        checkResult,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (err: any) {
      console.error(`[${this.id}] Pipeline error at ${lastStage}:`, err);
      return {
        post,
        botId: this.id,
        lastStage,
        searchContextResult: { text: content.text, searchResults: "", citations: [] },
        noteResult: { note: "", url: "", status: "ERROR" },
        error: err?.message || String(err),
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
  },
};
