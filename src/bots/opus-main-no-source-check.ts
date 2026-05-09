/**
 * Opus Main No Source Check Bot
 *
 * Same as opus-main-v2 but skips source verification.
 * A/B test: does X's evaluation check alone produce the same quality?
 */

import { Bot, PipelineResult } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/search/searchContextGoal";
import { writeNoteFn as writeNote } from "../pipeline/write/writeNote";
import { analyzeMedia } from "../pipeline/media/mediaAnalysis";

const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "anthropic/claude-opus-4.5",
  vision: "anthropic/claude-sonnet-4",
};

export const opusMainNoSourceCheck: Bot = {
  id: "opus-main-no-source-check",
  name: "Opus 4.5 (No Source Check)",
  description: "Same as opus-main-v2 but skips source verification — A/B test",
  async runPipeline(post, content): Promise<PipelineResult | null> {
    const warnings: string[] = [];

    // Media analysis (non-fatal — continues without it but records warning)
    let mediaContext = "";
    if (content.mediaItems?.length) {
      try {
        const mediaResult = await analyzeMedia(content.mediaItems, {
          visionModel: MODELS.vision,
        });
        mediaContext = mediaResult.contextForSearch;
        if (mediaResult.warnings.length > 0) {
          warnings.push(...mediaResult.warnings);
        }
      } catch (err: any) {
        const msg = `Media analysis failed: ${err.message}`;
        const strippedText = content.text.replace(/@\w+/g, "").replace(/https?:\/\/\S+/g, "").trim();
        if (strippedText.length < 20) {
          throw new Error(`${msg} (fatal: media-only tweet has no text to search with)`);
        }
        console.warn(`[${this.id}] ${msg} (continuing without media context)`);
        warnings.push(msg);
      }
    }

    const searchResult = await perplexitySearch(
      {
        text: content.text,
        media: content.media,
        mediaContext,
        quotedPostContext: content.quotedPostContext,
      },
      { model: MODELS.search }
    );

    const noteResult = await writeNote(
      {
        text: searchResult.text,
        searchResults: searchResult.searchResults,
        citations: searchResult.citations || [],
        mediaContext,
      },
      { model: MODELS.noteWriting }
    );

    return {
      post,
      botId: this.id,
      searchContextResult: searchResult,
      noteResult,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};
