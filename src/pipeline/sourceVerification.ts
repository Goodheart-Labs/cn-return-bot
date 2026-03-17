import { createGoal } from "@tonerow/agent-framework";
import { llm } from "./llm";
import { z } from "zod";
import { writeNoteOutput } from "./schemas";
import { writeNote } from "./writeNote";
import { getBrowser } from "./browserManager";

const prompt = (
  missingContext: string,
  sourceUrl: string,
  sourceContent: string
) => `
Given this source content and a community note, determine if the source DIRECTLY supports the specific factual correction made in the note.
Community note to check:
\`\`\`
${missingContext}
\`\`\`
Source URL: ${sourceUrl}
Source content:
\`\`\`
${sourceContent.substring(0, 30000)} // Limit to avoid token issues
\`\`\`
CRITICAL REQUIREMENTS:
- The source must specifically address the exact claim being corrected (not just general background)
- The source must be recent/relevant to the timeframe discussed in the original post
- The correction must be directly supported by clear statements in the source
- General context or tangentially related information does NOT count

Respond with ONLY:
- "YES" if the source directly and specifically supports the factual correction
- "NO" if the source lacks direct support, is about a different timeframe, or provides only general context

Do not provide any other text, quotes, or explanations. Just respond with YES or NO.`;

// Helper to fetch and simplify page content
async function fetchAndSimplifyContent(url: string): Promise<string> {
  const browser = await getBrowser(); // Reuse shared browser instance
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    // Get the main text content (body text)
    const content = await page.evaluate(() => {
      document
        .querySelectorAll("script, style, noscript")
        .forEach((el: Element) => (el as any).remove());
      return document.body.innerText || document.body.textContent || "";
    });
    return content;
  } finally {
    await page.close(); // Close page, not browser
  }
}

export async function verifySource(
  { url, note }: z.infer<typeof writeNoteOutput>,
  config?: { model?: string }
) {
  const model = config?.model ?? "anthropic/claude-sonnet-4";

  try {
    if (!url) {
      return "NO";
    }

    // Fetch and simplify the source content
    const sourceContent = await fetchAndSimplifyContent(url);

    const result = await llm.create({
      model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: prompt(note, url, sourceContent),
        },
      ],
    });

    return result.choices?.[0]?.message?.content ?? "";
  } catch (error) {
    console.error("Error in check function:", error);
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export const checkSource = createGoal({
  name: "check source",
  description:
    "Check if a source contains information that addresses the missing context",
  input: writeNoteOutput,
  output: z.string(),
});

const c = checkSource.register({ name: "check" });
c.define(verifySource);

checkSource.testFrom(writeNote);
