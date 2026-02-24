/**
 * Opus Main v2 Bot
 *
 * Primary bot using Claude Opus 4.5 with standard Perplexity search.
 * Uses the unified writeNote pipeline with URL-aware character counting.
 */

import { Bot, PipelineResult } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/searchContextGoal";
import { writeNoteFn as writeNote } from "../pipeline/writeNote";
import { check as checkNote } from "../pipeline/check";
import { analyzeMedia } from "../pipeline/mediaAnalysis";

const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-sonnet-4",
  vision: "anthropic/claude-sonnet-4",
};

export const opusMain: Bot = {
  id: "opus-main-v2",
  name: "Opus 4.5 (Main v2)",
  description: "Primary bot using Claude Opus 4.5 with unified note writer",
  weight: 40,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    try {
      // Media analysis (non-fatal — continues without it on failure)
      let mediaContext = "";
      if (content.mediaItems?.length) {
        try {
          const mediaResult = await analyzeMedia(content.mediaItems, {
            visionModel: MODELS.vision,
          });
          mediaContext = mediaResult.contextForSearch;
          lastStage = "media_analysis";
          console.log(`[${this.id}] Media analysis: ${mediaResult.videos.length} videos, ${mediaResult.images.length} images`);
        } catch (err: any) {
          console.error(`[${this.id}] Media analysis failed (continuing):`, err.message);
        }
      }

      const searchResult = await perplexitySearch(
        {
          text: content.text,
          media: content.media,
          searchResults: mediaContext,
          retweetContext: content.retweetContext,
        },
        { model: MODELS.search }
      );
      lastStage = "search";

      const noteResult = await writeNote(
        {
          text: searchResult.text,
          searchResults: searchResult.searchResults,
          citations: searchResult.citations || [],
        },
        { model: MODELS.noteWriting }
      );
      lastStage = "note_writing";

      const checkResult = await checkNote(
        {
          note: noteResult.note,
          url: noteResult.url,
          status: noteResult.status,
        },
        { model: MODELS.checking }
      );
      lastStage = "check";

      return {
        post,
        botId: this.id,
        lastStage,
        searchContextResult: searchResult,
        noteResult,
        checkResult,
      };
    } catch (err: any) {
      console.error(`[${this.id}] Pipeline error at ${lastStage}:`, err);
      return {
        post,
        botId: this.id,
        lastStage,
        searchContextResult: { text: content.text, searchResults: "", citations: [] },
        noteResult: { note: "", url: "", status: "ERROR" },
        checkResult: "",
        error: err?.message || String(err),
      };
    }
  },
};
