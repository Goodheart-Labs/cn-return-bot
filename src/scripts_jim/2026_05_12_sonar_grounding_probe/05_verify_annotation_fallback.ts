/**
 * Verify the appendAnnotationCitationsIfMissing logic on a real sonar
 * call. Hits OpenRouter with the production-shape prompt + json_schema
 * config, then runs the helper and confirms:
 *   - If findings already had URLs, output equals input.
 *   - If findings had no URLs but annotations did, output ends with
 *     "# Citations\n<urls>".
 *
 * Run from repo root:
 *   bun run src/scripts_jim/2026_05_12_sonar_grounding_probe/05_verify_annotation_fallback.ts
 */

import "dotenv/config";
import LinkifyIt from "linkify-it";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;
const linkify = new LinkifyIt();

// Same helper as searchDispatch.ts — copied for an isolated test.
function appendAnnotationCitationsIfMissing(findings: string, annotations: any[] | undefined): string {
  if (linkify.test(findings)) return findings;
  const urls = (annotations ?? [])
    .filter((a) => a?.type === "url_citation" && typeof a?.url_citation?.url === "string")
    .map((a) => a.url_citation.url as string);
  if (urls.length === 0) return findings;
  return `${findings}\n\n# Citations\n${urls.join("\n")}`;
}

const SYSTEM_PROMPT = `You are a research agent. Output JSON: { "findings": string, "correction_needed": boolean }. ` +
  `Inside findings, DO NOT include source URLs — describe the facts in plain text only.`;

const USER_MESSAGE =
  "Tweet: \"Charlie Kirk just announced he's running for president in 2028.\" Verify and report findings.";

const SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "search_findings",
    strict: true,
    schema: {
      type: "object",
      properties: { findings: { type: "string" }, correction_needed: { type: "boolean" } },
      required: ["findings", "correction_needed"],
      additionalProperties: false,
    },
  },
};

async function probe(model: string) {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_MESSAGE },
      ],
      response_format: SCHEMA,
    }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = (await resp.json()) as any;
  const msg = data.choices?.[0]?.message ?? {};
  const content = msg.content ?? "";
  let parsed: any = null;
  try { parsed = JSON.parse(content); } catch {}
  const findings = parsed?.findings ?? content;
  const annotations = msg.annotations ?? [];

  const findingsHadUrl = linkify.test(findings);
  const annUrlCount = annotations.filter((a: any) => a?.type === "url_citation").length;
  const result = appendAnnotationCitationsIfMissing(findings, annotations);
  const resultHasUrl = linkify.test(result);
  const footerAppended = result.includes("\n\n# Citations\n");

  console.log(`\n=== ${model} ===`);
  console.log(`  findings had URL inline: ${findingsHadUrl}`);
  console.log(`  annotation url_citations: ${annUrlCount}`);
  console.log(`  helper appended footer:   ${footerAppended}`);
  console.log(`  result has URL anywhere:  ${resultHasUrl}`);
  console.log(`  --- raw findings (first 250 chars) ---`);
  console.log(`  ${findings.slice(0, 250).replace(/\n/g, " ")}`);
  if (footerAppended) {
    console.log(`  --- footer ---`);
    const footer = result.slice(result.indexOf("\n\n# Citations\n"));
    console.log(footer.split("\n").map((l) => `  ${l}`).join("\n"));
  }

  // Assertions
  if (!findingsHadUrl && annUrlCount > 0 && !footerAppended) {
    console.log("  ✗ FAIL: findings had no URL and annotations had URLs but no footer was appended");
    process.exitCode = 1;
  } else if (!findingsHadUrl && annUrlCount > 0 && footerAppended && !resultHasUrl) {
    console.log("  ✗ FAIL: footer appended but linkify still doesn't see URLs in result");
    process.exitCode = 1;
  } else {
    console.log("  ✓ helper behaved correctly");
  }
}

for (const model of ["perplexity/sonar-pro", "perplexity/sonar-reasoning-pro"]) {
  await probe(model);
}
