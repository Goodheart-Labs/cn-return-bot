/**
 * Image Description
 *
 * Describes images using a vision model for fact-checking purposes.
 */

import { llm } from "../llm";

export interface ImageAnalysisResult {
  url: string;
  description: string;
  textContent?: string;
  error?: string;
}

export async function describeImage(
  imageUrl: string,
  model: string = "google/gemini-3-flash-preview"
): Promise<ImageAnalysisResult> {
  try {
    const result = await llm.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Describe this image in detail for fact-checking purposes. Include:
1. What the image shows (people, objects, text, setting)
2. Any visible text, numbers, or captions
3. Any claims or assertions the image appears to make
4. Context clues (location, time period, event type)
5. Anything that could be verified or fact-checked

Be specific and factual. If you see text, quote it exactly.`,
            },
            {
              type: "image_url",
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
    });

    const description = result.choices?.[0]?.message?.content || "";

    return {
      url: imageUrl,
      description: description as string,
    };
  } catch (err: any) {
    console.error("[imageDescription] Failed:", err.message);
    return {
      url: imageUrl,
      description: "",
      error: err.message,
    };
  }
}
