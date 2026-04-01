/**
 * Multi-Source Note Writer
 *
 * Variant of writeNote that encourages citing 2-3 sources inline.
 * Calibration data shows source count correlates with helpfulness (r=0.335).
 * URLs count as 1 character each (X shortens them), so multiple URLs
 * are feasible within the 275 char limit.
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

ONLY correct posts with clear factual errors supported by direct, relevant sources.

MULTIPLE SOURCES: Include 2-3 supporting URLs inline in your note text. Each URL counts as only 1 character (X shortens them). More sources = more credible correction. Place URLs naturally within or after the relevant claim they support.

CRITICAL LENGTH CONSTRAINT: Your note text MUST be under 275 characters. URLs count as only 1 character each. Be concise.

Please start by responding with one of the following statuses "TWEET NOT SIGNIFICANTLY INCORRECT" "NO MISSING CONTEXT" "CORRECTION WITH TRUSTWORTHY CITATION" "CORRECTION WITHOUT TRUSTWORTHY CITATION"

Format:
[Status]
[Correction with 2-3 inline URLs - under 275 chars with URLs as 1 char each]
[Primary source URL on its own line]

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

Include 2-3 supporting URLs inline. Each URL = 1 character. Be concise.

CRITICAL LENGTH CONSTRAINT: Note MUST be under 275 characters (URLs = 1 char each).

Format:
[Status]
[Correction with inline URLs - under 275 chars]
[Primary source URL]

YOUR PREVIOUS NOTE WAS ${characterCount} CHARACTERS — TOO LONG. Cut it down:
- Shorter words, fewer qualifiers
- Keep multiple URLs but trim the text around them

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

export async function writeNoteMultiSourceFn(
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
      let parsed: ReturnType<typeof parseStatusNoteUrl>;
      try {
        parsed = parseStatusNoteUrl(content);
      } catch (parseErr) {
        console.warn(`[writeNoteMultiSource] Failed to parse (attempt ${attempt}/${maxRetries}):`, (parseErr as Error).message);
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
    console.error("Error in writeNoteMultiSourceFn:", error);
    throw error;
  }
}
