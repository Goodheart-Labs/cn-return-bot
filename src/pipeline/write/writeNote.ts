import { createGoal } from "@tonerow/agent-framework";
import { z } from "zod";
import { llm } from "../llm/llm";
import { searchVersionOne } from "../search/searchContextGoal";
import { textAndSearchResults, writeNoteOutput } from "../llm/schemas";
import { parseStatusNoteUrl } from "../utils/parseStatusNoteUrl";
import { logLlmCall } from "../utils/tweetLog";
/**
 * Count note length treating URLs as 1 character each (X shortens URLs via t.co)
 */
export function countNoteLength(note: string): number {
  return note.replace(/https?:\/\/\S+/g, "X").length;
}

// Define the goal schema, similar to searchContext.ts
const writeNoteGoal = createGoal({
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
  quotedPostContext,
  currentDate,
  mediaContext,
}: {
  text: string;
  searchResults: string;
  citations: string[];
  quotedPostContext?: string;
  currentDate?: string;
  mediaContext?: string;
}) => `TASK: Analyze this X post and determine if it contains factual errors that require correction.${
  currentDate
    ? `

Today's date is ${currentDate}.`
    : ""
}${
  quotedPostContext
    ? `

${quotedPostContext}`
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
\`\`\`${
  mediaContext
    ? `

Media context (video/image analysis):
\`\`\`
${mediaContext}
\`\`\``
    : ""
}

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
  quotedPostContext,
  currentDate,
  mediaContext,
  previousNote,
  characterCount,
}: {
  text: string;
  searchResults: string;
  citations: string[];
  quotedPostContext?: string;
  currentDate?: string;
  mediaContext?: string;
  previousNote: string;
  characterCount: number;
}) => `TASK: Analyze this X post and determine if it contains factual errors that require correction.${
  currentDate
    ? `

Today's date is ${currentDate}.`
    : ""
}${
  quotedPostContext
    ? `

${quotedPostContext}`
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
\`\`\`${
  mediaContext
    ? `

Media context (video/image analysis):
\`\`\`
${mediaContext}
\`\`\``
    : ""
}

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
    quotedPostContext,
    mediaContext,
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
          quotedPostContext,
          currentDate: config.currentDate,
          mediaContext,
        });
      } else {
        if (!previousParsed) {
          throw new Error("Previous result not available for retry");
        }

        prompt = retryPromptTemplate({
          text,
          searchResults,
          citations,
          quotedPostContext,
          currentDate: config.currentDate,
          mediaContext,
          previousNote: previousParsed.note,
          characterCount: countNoteLength(previousParsed.note),
        });
      }

      const messages = [{ role: "user" as const, content: prompt }];
      const startMs = Date.now();
      const result = await llm.create({
        model: config.model,
        messages,
      });

      const content = result.choices?.[0]?.message?.content ?? "";
      const label = attempt === 1 ? "noteWriter" : `noteWriter.retry${attempt - 1}`;
      logLlmCall(label, messages, content, Date.now() - startMs);
      let parsed: ReturnType<typeof parseStatusNoteUrl>;
      try {
        parsed = parseStatusNoteUrl(content);
      } catch (parseErr) {
        console.warn(`[writeNote] Failed to parse LLM response (attempt ${attempt}/${maxRetries}):`, (parseErr as Error).message, `| Raw content: "${content.slice(0, 200)}"`);
        if (attempt >= maxRetries) {
          return { status: "PARSE_ERROR", note: "", url: "" };
        }
        continue;
      }

      // Only enforce character limit on corrections — non-correction statuses
      // (NO MISSING CONTEXT, TWEET NOT SIGNIFICANTLY INCORRECT, etc.) are
      // rejected downstream and never submitted, so length doesn't matter.
      if (parsed.status !== "CORRECTION WITH TRUSTWORTHY CITATION") {
        return parsed;
      }

      const effectiveLength = countNoteLength(parsed.note);
      if (effectiveLength <= 275) {
        return parsed;
      }

      previousParsed = parsed;

      if (attempt >= maxRetries) {
        const errorMsg = `Note exceeds 275 char limit after ${maxRetries} attempts (${effectiveLength} effective, ${parsed.note.length} raw). Note: "${parsed.note}" URL: ${parsed.url || "(none)"}`;
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
