/**
 * Prompt — media analysis (image / video / frame).
 *
 * These are the base instructions for the vision model. The call site appends an
 * entity hint to them. See analyzeMediaGemini in
 * src/pipeline/media/mediaAnalysisGemini.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";

export const IMAGE_PROMPT = `Analyze this image. Describe what it shows and extract all visible text.`;

export const VIDEO_PROMPT = `Analyze this video. Describe what happens and extract all visible text.`;

export const FRAME_PROMPT = `These are frames extracted from a video. Describe what happens per frame and extract all visible text per frame`;

/** The strict answer shape for a media call that goes through OpenRouter. Loose
 *  JSON mode is not enough here: asked to describe frames "per frame", Muse
 *  wraps its answer in its own list of frames and leaves `description` unset. */
export const MEDIA_RESPONSE_FORMAT = jsonSchemaResponseFormat("media_description", {
  type: "object",
  properties: {
    description: { type: "string", description: "A factual description of the media content" },
    ocr_text: { type: "string", description: "All visible text, quoted exactly. Empty string if none." },
  },
  required: ["description", "ocr_text"],
  additionalProperties: false,
});
