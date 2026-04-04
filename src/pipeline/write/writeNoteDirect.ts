/**
 * Direct Note Writer
 *
 * Alternative writeNote prompt designed based on analysis of 302 "lost cases" —
 * tweets where a competing note won CRH status while ours stayed at NMR.
 *
 * Key patterns from winning notes:
 * - Lead with the single strongest contradicting fact, not "The post claims..."
 * - State what IS true rather than explaining what's wrong
 * - Short punchy sentences (1-2 sentences before the URL)
 * - Prefer primary sources (X posts, official sites, Wikipedia) over news articles
 * - Don't over-explain or address multiple aspects
 */

import { z } from "zod";
import { llm } from "../llm/llm";
import { textAndSearchResults } from "../llm/schemas";
import { parseStatusNoteUrl } from "../utils/parseStatusNoteUrl";
import { countNoteLength } from "./writeNote";
import { logLlmCall } from "../utils/tweetLog";

const promptTemplate = ({
  text,
  searchResults,
  citations,
  quotedPostContext,
  currentDate,
}: {
  text: string;
  searchResults: string;
  citations: string[];
  quotedPostContext?: string;
  currentDate?: string;
}) => `TASK: Write a Community Note correction for this X post — if it contains a clear factual error.${
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

STYLE RULES — these are critical for getting your note rated helpful:
1. LEAD WITH THE FACT: Open with what is actually true, not "The post claims..." or "This is false because..."
   GOOD: "This video was recorded in January 2024 during a murder trial."
   GOOD: "Smiling Friends was renewed for seasons 4 and 5 in June 2025."
   BAD: "The post falsely claims that Smiling Friends was cancelled."
   BAD: "Post contains factual errors regarding the show's status."
2. ONE KEY FACT: Pick the single strongest piece of evidence. Don't try to address everything.
3. SHORT AND DIRECT: 1-2 sentences before the URL. Every word must earn its place.
4. PREFER PRIMARY SOURCES: X posts, official announcements, Wikipedia, YouTube originals > news articles.
5. NO HEDGING: Don't say "appears to", "seems to", "potentially". Be definitive.

ONLY correct posts with clear factual errors. Respond with a status, then note, then URL.

CRITICAL LENGTH CONSTRAINT: Note text MUST be under 275 characters. URLs count as 1 character (X shortens them).

Format:
[Status: one of "TWEET NOT SIGNIFICANTLY INCORRECT" "NO MISSING CONTEXT" "CORRECTION WITH TRUSTWORTHY CITATION" "CORRECTION WITHOUT TRUSTWORTHY CITATION"]
[1-2 sentence correction leading with the key fact — under 275 chars with URLs as 1 char]
[Best source URL — prefer primary/official sources]

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

const retryPromptTemplate = ({
  text,
  searchResults,
  citations,
  quotedPostContext,
  currentDate,
  previousNote,
  characterCount,
}: {
  text: string;
  searchResults: string;
  citations: string[];
  quotedPostContext?: string;
  currentDate?: string;
  previousNote: string;
  characterCount: number;
}) => `TASK: Write a Community Note correction for this X post — if it contains a clear factual error.${
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

STYLE RULES — these are critical for getting your note rated helpful:
1. LEAD WITH THE FACT: Open with what is actually true, not "The post claims..."
2. ONE KEY FACT: Pick the single strongest piece of evidence.
3. SHORT AND DIRECT: 1-2 sentences before the URL.
4. PREFER PRIMARY SOURCES: X posts, official sites, Wikipedia > news articles.
5. NO HEDGING: Be definitive.

CRITICAL LENGTH CONSTRAINT: Note text MUST be under 275 characters. URLs count as 1 character.

Format:
[Status]
[1-2 sentence correction — under 275 chars with URLs as 1 char]
[Source URL]

YOUR PREVIOUS NOTE WAS ${characterCount} CHARACTERS — TOO LONG. Cut it down NOW:
- Remove "The post claims..." framing
- Use shorter words
- Keep only the single strongest fact
- Remove any hedging or qualifiers

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

export async function writeNoteDirectFn(
  {
    text,
    searchResults,
    citations,
    quotedPostContext,
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
          previousNote: previousParsed.note,
          characterCount: countNoteLength(previousParsed.note),
        });
      }

      const messages = [{ role: "user" as const, content: prompt }];
      const startMs = Date.now();
      const result = await llm.create({ model: config.model, messages });

      const content = result.choices?.[0]?.message?.content ?? "";
      const label = attempt === 1 ? "noteWriter" : `noteWriter.retry${attempt - 1}`;
      logLlmCall(label, messages, content, Date.now() - startMs);
      const parsed = parseStatusNoteUrl(content);

      // Only enforce character limit on corrections — non-correction statuses
      // are rejected downstream and never submitted.
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
    console.error("Error in writeNoteDirectFn:", error);
    throw error;
  }
}
