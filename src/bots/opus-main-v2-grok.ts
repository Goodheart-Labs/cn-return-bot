/**
 * Opus Main v2 + Grok Bot
 *
 * Same as opus-main-v2 (URL-aware char counting) but with Grok X search
 * running in parallel with Perplexity for richer tweet context.
 */

import { Bot, PipelineResult } from "./types";
import { enrichedSearch } from "../pipeline/enrichedSearch";
import { writeNoteFn as writeNote } from "../pipeline/writeNote";
import { check as checkNote } from "../pipeline/check";
import { analyzeMedia } from "../pipeline/mediaAnalysis";

const MODELS = {
  search: "perplexity/sonar",
  grokSearch: "grok-4-fast",
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-sonnet-4",
  vision: "anthropic/claude-sonnet-4",
};

export const opusMainV2Grok: Bot = {
  id: "opus-main-v2-grok",
  name: "Opus 4.5 (Main v2 + Grok)",
  description: "Opus Main v2 with Grok X search for tweet context",
  weight: 6,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    try {
      // Media analysis (non-fatal)
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

      const searchResult = await enrichedSearch(
        {
          text: content.text,
          media: content.media,
          searchResults: mediaContext,
          retweetContext: content.retweetContext,
        },
        { perplexityModel: MODELS.search, grokModel: MODELS.grokSearch },
        post.id
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
