/**
 * Verify the appendSonarCitations helper end-to-end against live sonar.
 * Tests two prompt shapes per model:
 *   A. "no URLs inline" → expect "# Citations" header with all annotation URLs.
 *   B. "URLs inline" (asks the model to inline some)
 *      → expect "# Additional Citations" header with only the annotations
 *      that are NOT already in the findings text.
 *
 * Run from repo root:
 *   bun run src/scripts_jim/2026_05_12_sonar_grounding_probe/05_verify_annotation_fallback.ts
 */

import "dotenv/config";
import LinkifyIt from "linkify-it";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;
const linkify = new LinkifyIt();

// Same helper as searchDispatch.ts — copied here to keep the probe isolated.
function appendSonarCitations(findings: string, annotations: any[] | undefined): string {
  const annotationUrls = (annotations ?? [])
    .filter((a) => a?.type === "url_citation" && typeof a?.url_citation?.url === "string")
    .map((a) => a.url_citation.url as string);
  if (annotationUrls.length === 0) return findings;

  const inlineUrls = new Set((linkify.match(findings) ?? []).map((m) => m.url));
  const missing = annotationUrls.filter((url) => !inlineUrls.has(url));
  if (missing.length === 0) return findings;

  const header = inlineUrls.size > 0 ? "# Additional Citations" : "# Citations";
  return `${findings}\n\n${header}\n${missing.join("\n")}`;
}

const PROMPT_NO_INLINE_URLS =
  `You are a research agent. Output JSON: { "findings": string, "correction_needed": boolean }. ` +
  `Inside findings, DO NOT include source URLs — describe the facts in plain text only.`;

const PROMPT_WITH_INLINE_URLS =
  `You are a research agent. Output JSON: { "findings": string, "correction_needed": boolean }. ` +
  `Inside findings, include 1-2 https:// source URLs inline next to the key claims you cite.`;

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

interface CaseResult {
  model: string;
  case: "no_inline" | "with_inline";
  inline_url_count: number;
  annotation_url_count: number;
  missing_count: number;
  expected_header: "# Citations" | "# Additional Citations" | "(no footer)";
  actual_header: string;
  passed: boolean;
}

async function runCase(model: string, kind: "no_inline" | "with_inline"): Promise<CaseResult> {
  const systemPrompt = kind === "no_inline" ? PROMPT_NO_INLINE_URLS : PROMPT_WITH_INLINE_URLS;
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
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
  const findings: string = parsed?.findings ?? content;
  const annotations = msg.annotations ?? [];

  const inlineUrls = new Set((linkify.match(findings) ?? []).map((m) => m.url));
  const annotationUrls = annotations
    .filter((a: any) => a?.type === "url_citation" && typeof a?.url_citation?.url === "string")
    .map((a: any) => a.url_citation.url as string);
  const missing = annotationUrls.filter((u: string) => !inlineUrls.has(u));

  const result = appendSonarCitations(findings, annotations);

  let expected_header: CaseResult["expected_header"];
  if (annotationUrls.length === 0 || missing.length === 0) expected_header = "(no footer)";
  else if (inlineUrls.size > 0) expected_header = "# Additional Citations";
  else expected_header = "# Citations";

  let actual_header = "(no footer)";
  if (result.includes("\n\n# Citations\n")) actual_header = "# Citations";
  if (result.includes("\n\n# Additional Citations\n")) actual_header = "# Additional Citations";

  const passed = actual_header === expected_header;
  console.log(`\n[${model}  case=${kind}]`);
  console.log(`  inline URL count:      ${inlineUrls.size}`);
  console.log(`  annotation URL count:  ${annotationUrls.length}`);
  console.log(`  missing (annotation \\ inline): ${missing.length}`);
  console.log(`  expected header:       ${expected_header}`);
  console.log(`  actual header:         ${actual_header}`);
  console.log(`  ${passed ? "✓ pass" : "✗ FAIL"}`);
  console.log(`  --- findings (first 250 chars) ---`);
  console.log(`  ${findings.slice(0, 250).replace(/\n/g, " ")}`);
  if (actual_header !== "(no footer)") {
    const footerStart = result.indexOf("\n\n#");
    console.log(`  --- footer ---`);
    console.log(result.slice(footerStart).split("\n").map((l) => `  ${l}`).join("\n"));
  }
  return {
    model, case: kind,
    inline_url_count: inlineUrls.size,
    annotation_url_count: annotationUrls.length,
    missing_count: missing.length,
    expected_header, actual_header, passed,
  };
}

const models = ["perplexity/sonar-pro", "perplexity/sonar-reasoning-pro"];
const cases: Array<"no_inline" | "with_inline"> = ["no_inline", "with_inline"];
const results: CaseResult[] = [];
for (const model of models) {
  for (const c of cases) results.push(await runCase(model, c));
}

console.log("\n=== Summary ===");
console.log("model".padEnd(33) + "case".padEnd(14) + "inline".padEnd(8) + "ann".padEnd(6) + "miss".padEnd(6) + "header".padEnd(24) + "result");
console.log("-".repeat(110));
for (const r of results) {
  console.log(
    r.model.padEnd(33) +
      r.case.padEnd(14) +
      String(r.inline_url_count).padEnd(8) +
      String(r.annotation_url_count).padEnd(6) +
      String(r.missing_count).padEnd(6) +
      r.actual_header.padEnd(24) +
      (r.passed ? "✓ pass" : "✗ FAIL"),
  );
}
process.exitCode = results.every((r) => r.passed) ? 0 : 1;
