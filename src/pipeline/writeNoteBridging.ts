/**
 * Bridging Note Writer
 *
 * Variant of writeNote optimized for bridging language — corrections that
 * people across the political spectrum would find useful. Bridging is the
 * strongest predictor of helpfulness (r=0.558, d=1.34) from calibration.
 */

import { z } from "zod";
import { llm } from "./llm";
import { textAndSearchResults } from "./schemas";
import { parseStatusNoteUrl } from "./parseStatusNoteUrl";
import { countNoteLength } from "./writeNote";

const promptTemplate = ({
  text,
  searchResults,
  citations,
  retweetContext,
  currentDate,
}: {
  text: string;
  searchResults: string;
  citations: string[];
  retweetContext?: string;
  currentDate?: string;
}) => `TASK: Analyze this X post and determine if it contains factual errors that require correction.${
  currentDate
    ? `

Today's date is ${currentDate}.`
    : ""
}${
  retweetContext
    ? `

${retweetContext}`
    : ""
}

CRITICAL ANALYSIS STEPS:
1. IDENTIFY THE SPECIFIC CLAIM: What exact factual assertion is the post making?
2. VERIFY ACCURACY: Do the search results directly contradict this specific claim?
3. SOURCE RELEVANCE: Do the sources directly address this claim (not general background)?
4. DIRECTNESS: Can you definitively say "this specific claim is false" based on the evidence?

ONLY correct posts with clear factual errors supported by direct, relevant sources.

BRIDGING TONE — this is critical for getting your note rated helpful:
- Write so that people who AGREE with the post and people who DISAGREE would both find your note informative and fair
- State factual corrections neutrally — no sarcasm, no "gotcha" framing, no partisan language
- Acknowledge what the post gets right (if anything) before correcting what it gets wrong
- Use precise, measured language: "According to [source]..." rather than "This is false"
- Avoid loaded words: don't say "claims", "falsely", "misleading" — just state what's true
- Your goal is to inform, not to win an argument

CRITICAL LENGTH CONSTRAINT: Your note text MUST be under 275 characters. URLs count as only 1 character. Be concise.

Please start by responding with one of the following statuses "TWEET NOT SIGNIFICANTLY INCORRECT" "NO MISSING CONTEXT" "CORRECTION WITH TRUSTWORTHY CITATION" "CORRECTION WITHOUT TRUSTWORTHY CITATION"

Format:
[Status]
[Neutral, bridging correction - under 275 chars with URLs as 1 char]
[Source URL]

Post perhaps in need of community note:
\`\`\`
${text}
\`\`\`

Research context:
\`\`\`
${searchResults}

Citations:
\`\`\`
${citations.join("\n")}
\`\`\``;

const retryPromptTemplate = ({
  text,
  searchResults,
  citations,
  retweetContext,
  currentDate,
  previousNote,
  characterCount,
}: {
  text: string;
  searchResults: string;
  citations: string[];
  retweetContext?: string;
  currentDate?: string;
  previousNote: string;
  characterCount: number;
}) => `TASK: Analyze this X post and determine if it contains factual errors that require correction.${
  currentDate
    ? `

Today's date is ${currentDate}.`
    : ""
}${
  retweetContext
    ? `

${retweetContext}`
    : ""
}

Write in a neutral, bridging tone that people on all sides would find fair and informative.

CRITICAL LENGTH CONSTRAINT: Note MUST be under 275 characters (URLs = 1 char each).

Format:
[Status]
[Neutral correction - under 275 chars]
[Source URL]

YOUR PREVIOUS NOTE WAS ${characterCount} CHARACTERS — TOO LONG. Cut it down.

Previous note: "${previousNote}"

Post:
\`\`\`
${text}
\`\`\`

Research:
\`\`\`
${searchResults}

Citations:
\`\`\`
${citations.join("\n")}
\`\`\``;

export async function writeNoteBridgingFn(
  {
    text,
    searchResults,
    citations,
    retweetContext,
  }: z.infer<typeof textAndSearchResults>,
  config: {
    model: string;
    currentDate?: string;
  }
) {
  const maxRetries = 3;
  let attempt = 0;
  let previousParsed: ReturnType<typeof parseStatusNoteUrl> | null = null;

  try {
    while (attempt < maxRetries) {
      attempt++;

      let prompt: string;
      if (attempt === 1) {
        prompt = promptTemplate({
          text,
          searchResults,
          citations,
          retweetContext,
          currentDate: config.currentDate,
        });
      } else {
        if (!previousParsed) {
          throw new Error("Previous result not available for retry");
        }

        prompt = retryPromptTemplate({
          text,
          searchResults,
          citations,
          retweetContext,
          currentDate: config.currentDate,
          previousNote: previousParsed.note,
          characterCount: countNoteLength(previousParsed.note),
        });
      }

      const result = await llm.create({
        model: config.model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = result.choices?.[0]?.message?.content ?? "";
      let parsed: ReturnType<typeof parseStatusNoteUrl>;
      try {
        parsed = parseStatusNoteUrl(content);
      } catch (parseErr) {
        console.warn(`[writeNoteBridging] Failed to parse (attempt ${attempt}/${maxRetries}):`, (parseErr as Error).message);
        if (attempt >= maxRetries) {
          return { status: "PARSE_ERROR", note: "", url: "" };
        }
        continue;
      }

      if (parsed.status !== "CORRECTION WITH TRUSTWORTHY CITATION") {
        return parsed;
      }

      const effectiveLength = countNoteLength(parsed.note);
      if (effectiveLength <= 275) {
        return parsed;
      }

      previousParsed = parsed;

      if (attempt >= maxRetries) {
        const errorMsg = `Note exceeds 275 char limit after ${maxRetries} attempts (${effectiveLength} effective). Note: "${parsed.note}"`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
    }

    throw new Error("Unexpected error in retry logic");
  } catch (error) {
    console.error("Error in writeNoteBridgingFn:", error);
    throw error;
  }
}
