/**
 * Prompt — Gemini media analysis (image / video / frame).
 *
 * These are the base instructions for the vision model. The call site appends an
 * entity hint to them. See analyzeMediaGemini in
 * src/pipeline/media/mediaAnalysisGemini.ts.
 */

export const IMAGE_PROMPT = `Analyze this image. Describe what it shows and extract all visible text.`;

export const VIDEO_PROMPT = `Analyze this video. Describe what happens and extract all visible text.`;

export const FRAME_PROMPT = `These are frames extracted from a video. Describe what happens per frame and extract all visible text per frame`;
