import { createGoal } from "@tonerow/agent-framework";
import { z } from "zod";
import { llm } from "./llm";
import { searchVersionOne } from "./searchContextGoal";
import { textAndSearchResults, writeNoteOutput } from "./schemas";
import { parseStatusNoteUrl } from "./parseStatusNoteUrl";
/**
 * Count note length treating URLs as 1 character each (X shortens URLs via t.co)
 */
export function countNoteLength(note: string): number {
  return note.replace(/https?:\/\/\S+/g, "X").length;
}

// Define the goal schema, similar to searchContext.ts
export const writeNoteGoal = createGoal({
  name: "write note with search",
  description:
    "Write a Community Note for a post on X using search results for context.",
  input: textAndSearchResults,
  output: writeNoteOutput,
});

writeNoteGoal.testFrom(searchVersionOne);

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

ONLY correct posts with clear factual errors supported by direct, relevant sources. Avoid:
- General background context that doesn't contradict the claim
- Sources about different timeframes than what the post discusses
- Correcting things the post never actually claimed
- Vague corrections that don't directly address the core assertion

CRITICAL LENGTH CONSTRAINT: Your note text MUST be under 275 characters. URLs are shortened by X and count as only 1 character toward this limit. Be concise - every word must earn its place.

Please start by responding with one of the following statuses "TWEET NOT SIGNIFICANTLY INCORRECT" "NO MISSING CONTEXT" "CORRECTION WITH TRUSTWORTHY CITATION" "CORRECTION WITHOUT TRUSTWORTHY CITATION"

Format:
[Status]
[Direct correction stating exactly what is wrong - MUST be under 275 chars with URLs counting as 1]
[URL that specifically contradicts the claim]

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

CRITICAL ANALYSIS STEPS:
1. IDENTIFY THE SPECIFIC CLAIM: What exact factual assertion is the post making?
2. VERIFY ACCURACY: Do the search results directly contradict this specific claim?
3. SOURCE RELEVANCE: Do the sources directly address this claim (not general background)?
4. DIRECTNESS: Can you definitively say "this specific claim is false" based on the evidence?

ONLY correct posts with clear factual errors supported by direct, relevant sources. Avoid:
- General background context that doesn't contradict the claim
- Sources about different timeframes than what the post discusses
- Correcting things the post never actually claimed
- Vague corrections that don't directly address the core assertion

CRITICAL LENGTH CONSTRAINT: Your note text MUST be under 275 characters. URLs are shortened by X and count as only 1 character toward this limit. Be concise - every word must earn its place.

Please start by responding with one of the following statuses "TWEET NOT SIGNIFICANTLY INCORRECT" "NO MISSING CONTEXT" "CORRECTION WITH TRUSTWORTHY CITATION" "CORRECTION WITHOUT TRUSTWORTHY CITATION"

Format:
[Status]
[Direct correction stating exactly what is wrong - MUST be under 275 chars with URLs counting as 1]
[URL that specifically contradicts the claim]

🚨 CRITICAL FAILURE: Your previous note was ${characterCount} characters (with URLs as 1 char) - this VIOLATES the strict 275 character limit! You MUST drastically reduce this length NOW. This is NOT a suggestion - it is MANDATORY.

REQUIRED ACTIONS:
- CUT unnecessary words and filler phrases
- Use shorter synonyms and abbreviations
- ELIMINATE any non-essential details
- Remove redundant information
- Make every single word count

The 275 character limit is ABSOLUTE and NON-NEGOTIABLE. FAILURE to comply will result in rejection.

Previous note: "${previousNote}"

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

export const writeNote = writeNoteGoal.register({
  name: "write note v1",
  config: [{ model: "anthropic/claude-sonnet-4" }],
});

export async function writeNoteFn(
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
      const parsed = parseStatusNoteUrl(content);

      const effectiveLength = countNoteLength(parsed.note);
      if (effectiveLength <= 275) {
        return parsed;
      }

      previousParsed = parsed;

      if (attempt >= maxRetries) {
        const errorMsg = `Note exceeds 275 character limit after ${maxRetries} attempts: ${effectiveLength} effective characters (${parsed.note.length} raw)`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
    }

    throw new Error("Unexpected error in retry logic");
  } catch (error) {
    console.error("Error in writeNoteFn:", error);
    throw error;
  }
}

writeNote.define(writeNoteFn);
