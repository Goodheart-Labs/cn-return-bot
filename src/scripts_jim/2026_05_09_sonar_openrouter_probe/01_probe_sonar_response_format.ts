/**
 * Probe Perplexity sonar models via OpenRouter to figure out which JSON-output
 * configuration actually works.
 *
 * Background: PR #129's investigation suggested sonar errors out on
 * `response_format: json_schema`. Production data over the last 14 days shows
 * that's mostly NOT what we see — sonar-pro had 0 failures and
 * sonar-reasoning-pro had only 1 (model output was not valid JSON, content="").
 * So the question is more subtle: what's the *most reliable* config, and
 * what does sonar actually return under each.
 *
 * Tests four configs × 2 models (sonar-pro, sonar-reasoning-pro):
 *   A. response_format: json_schema (current production)
 *   B. response_format: json_object (looser)
 *   C. no response_format (prompt-only)
 *   D. no response_format + JSON instruction in prompt
 *
 * Run from repo root:
 *   bun run src/scripts_jim/2026_05_09_sonar_openrouter_probe/01_probe_sonar_response_format.ts
 *
 * Output: console table showing finish_reason, content shape, cost per
 * (model, config) — picks the winner.
 */

import "dotenv/config";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

const SYSTEM_PROMPT =
  "You are a research agent for Community Notes fact-checking on X/Twitter. " +
  "Your job: investigate whether the post below contains a factual error.";

const USER_MESSAGE =
  "Tweet posted by @scientist on 2026-05-08:\n\n" +
  '"The James Webb Space Telescope just discovered the first earth-like planet' +
  ' in a habitable zone! NASA confirms liquid water!"\n\n' +
  "Investigate and return findings + correction_needed.";

const SCHEMA_OBJ = {
  type: "object",
  properties: {
    findings: { type: "string" },
    correction_needed: { type: "boolean" },
  },
  required: ["findings", "correction_needed"],
  additionalProperties: false,
};

const JSON_SCHEMA_FORMAT = {
  type: "json_schema" as const,
  json_schema: { name: "search_findings", strict: true, schema: SCHEMA_OBJ },
};

const JSON_OBJECT_FORMAT = { type: "json_object" as const };

const JSON_INSTRUCTION =
  "\n\nRespond with strict JSON only matching: " +
  '{ "findings": string, "correction_needed": boolean }';

const MODELS = ["perplexity/sonar-pro", "perplexity/sonar-reasoning-pro"] as const;

const CONFIGS = [
  { label: "A. response_format=json_schema", body: { response_format: JSON_SCHEMA_FORMAT } },
  { label: "B. response_format=json_object", body: { response_format: JSON_OBJECT_FORMAT } },
  { label: "C. no response_format, plain system prompt", body: {} },
  { label: "D. no response_format + JSON instruction in prompt", body: { extra_user: JSON_INSTRUCTION } },
] as const;

interface Result {
  model: string;
  config: string;
  http_ok: boolean;
  http_status?: number;
  http_error?: string;
  finish_reason?: string;
  content_shape?: "json" | "markdown_fenced" | "preamble" | "plain_text" | "empty" | "error";
  content_first_200?: string;
  citations_count?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  reported_cost_usd?: number;
}

function classify(content: string): Result["content_shape"] {
  const s = content.trim();
  if (!s) return "empty";
  try {
    JSON.parse(s);
    return "json";
  } catch {
    /* fallthrough */
  }
  if (s.startsWith("```") || s.includes("```json")) return "markdown_fenced";
  if (s.includes("{")) return "preamble";
  return "plain_text";
}

async function probe(model: string, config: typeof CONFIGS[number]): Promise<Result> {
  const userContent = USER_MESSAGE + ((config.body as any).extra_user ?? "");
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  };
  if ((config.body as any).response_format) body.response_format = (config.body as any).response_format;

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      return {
        model,
        config: config.label,
        http_ok: false,
        http_status: resp.status,
        http_error: (await resp.text()).slice(0, 200),
      };
    }
    const data = (await resp.json()) as any;
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";
    return {
      model,
      config: config.label,
      http_ok: true,
      finish_reason: choice?.finish_reason,
      content_shape: classify(content),
      content_first_200: content.slice(0, 200),
      citations_count: (data.citations ?? choice?.message?.citations ?? []).length,
      prompt_tokens: data.usage?.prompt_tokens,
      completion_tokens: data.usage?.completion_tokens,
      reported_cost_usd: data.usage?.cost,
    };
  } catch (err: any) {
    return { model, config: config.label, http_ok: false, http_error: err?.message?.slice(0, 200) };
  }
}

async function main(): Promise<void> {
  const results: Result[] = [];
  for (const model of MODELS) {
    for (const config of CONFIGS) {
      console.log(`Probing ${model}  ${config.label}`);
      results.push(await probe(model, config));
    }
  }

  // Summary table
  console.log(
    "\n" +
      "model".padEnd(33) +
      "config".padEnd(48) +
      "ok".padEnd(5) +
      "shape".padEnd(18) +
      "finish".padEnd(12) +
      "cite  cost",
  );
  console.log("-".repeat(130));
  for (const r of results) {
    const ok = r.http_ok ? "✓" : `${r.http_status ?? "ERR"}`;
    const shape = r.content_shape ?? "-";
    const finish = r.finish_reason ?? "-";
    const cite = r.citations_count ?? "-";
    const cost = r.reported_cost_usd != null ? `$${r.reported_cost_usd.toFixed(4)}` : "-";
    console.log(
      r.model.padEnd(33) +
        r.config.padEnd(48) +
        String(ok).padEnd(5) +
        String(shape).padEnd(18) +
        String(finish).padEnd(12) +
        `${cite}  ${cost}`,
    );
    if (!r.http_ok) {
      console.log(`    ↳ ${r.http_error?.slice(0, 200)}`);
    } else if (r.content_shape !== "json") {
      console.log(`    ↳ ${r.content_first_200?.replace(/\n/g, " ").slice(0, 150)}`);
    }
  }
}

main();
