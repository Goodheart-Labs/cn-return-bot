/**
 * Prompt — Gemini media analysis (image / video / frame).
 *
 * Base instructions for the vision model; the call site appends an entity hint.
 * See analyzeMediaGemini in src/pipeline/media/mediaAnalysisGemini.ts.
 */

export const IMAGE_PROMPT = `Analyze this image. Describe what it shows and extract all visible text.`;

export const VIDEO_PROMPT = `Analyze this video. Describe what happens and extract all visible text.`;

export const FRAME_PROMPT = `These are frames extracted from a video. Describe what happens per frame and extract all visible text per frame`;
