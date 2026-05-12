/**
 * Probe whether Perplexity sonar models via OpenRouter actually ground their
 * responses in web search under different configurations.
 *
 * Background (from PR #129 prod failure and PR #130 followup): a prod
 * sonar-reasoning-pro run hallucinated an answer about a public figure
 * being alive when he had died months earlier. PR #130's earlier probe
 * showed `cite=0` for *every* sonar config but called the experiment
 * "✓ json" because the JSON parsed — failing to notice the grounding
 * itself was disabled.
 *
 * This probe specifically asks a question that ONLY a live web search can
 * answer correctly, then inspects:
 *   1. Did the response parse as JSON?
 *   2. Did the response include citations / search_results / URLs anywhere?
 *   3. Did the model get the answer right (proxy for "did it actually search")?
 *   4. Cost — sonar searches charge per-search, so cost is a sanity check
 *      that the search step ran.
 *
 * Tests sonar-pro × sonar-reasoning-pro × {A=current-prod, D=prompted-JSON-no-rf,
 * E=no rf no JSON instruction}.
 *
 * Run from repo root:
 *   bun run src/scripts_jim/2026_05_12_sonar_grounding_probe/01_probe_sonar_grounding.ts
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

const SYSTEM_PROMPT =
  "You are a research agent for Community Notes fact-checking on X/Twitter. " +
  "Use the web_search tool to find evidence; ALWAYS cite the full URL inline.";

// Question that requires fresh, post-training web data to answer correctly.
// Charlie Kirk was assassinated 2025-09-10; the post-PR-129 prod run
// confidently claimed he was still alive. A grounded sonar response should
// surface his death; an ungrounded response will hallucinate.
const USER_MESSAGE =
  "Tweet posted 2026-05-09 by @Marlene_Robertson:\n\n" +
  "\"Erika Kirk, who runs a white nationalist religious cult, just received an Honorary " +
  "Doctorate on behalf of her dead racist podcaster husband. I'm fucking speechless. " +
  "https://t.co/jrZnmmhmYC\"\n\n" +
  "Is the post factually correct? Specifically, is Charlie Kirk dead? Cite full URLs.";

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

const JSON_INSTRUCTION =
  '\n\nRespond with strict JSON only matching: { "findings": string, "correction_needed": boolean }. ' +
  "Inside findings, include every source URL inline next to the claim it supports.";

interface Result {
  model: string;
  config: string;
  http_ok: boolean;
  http_status?: number;
  http_error?: string;
  finish_reason?: string;
  content_shape?: "json" | "json_after_fence_strip" | "json_after_think_strip" | "markdown_fenced" | "preamble" | "plain_text" | "empty" | "error";
  parsed_findings_first_200?: string;
  parsed_correction_needed?: boolean;
  /** Number of distinct URL references the model returned in any field. */
  url_count_in_content: number;
  /** URLs surfaced in known Perplexity citation channels. */
  response_top_level_citations: number;
  response_search_results: number;
  message_citations: number;
  message_annotations: number;
  /** All distinct response-object keys, for shape forensics. */
  response_keys: string[];
  message_keys: string[];
  /** Whether the response mentions Charlie Kirk's death — proxy for "search actually ran". */
  mentions_death: boolean;
  prompt_tokens?: number;
  completion_tokens?: number;
  reported_cost_usd?: number;
  raw_first_400?: string;
}

function countUrls(s: string): number {
  if (!s) return 0;
  const m = s.match(/https?:\/\/\S+/g);
  return m ? new Set(m.map((u) => u.replace(/[).,;]+$/, ""))).size : 0;
}

function classify(content: string): { shape: Result["content_shape"]; parsedJson: any | null } {
  const s = content.trim();
  if (!s) return { shape: "empty", parsedJson: null };
  try {
    return { shape: "json", parsedJson: JSON.parse(s) };
  } catch {}
  // Strip <think>...</think> blocks (sonar-reasoning emits reasoning before JSON).
  const sansThink = s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (sansThink !== s) {
    try {
      return { shape: "json_after_think_strip", parsedJson: JSON.parse(sansThink) };
    } catch {}
  }
  // Strip ```json fences.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return { shape: "json_after_fence_strip", parsedJson: JSON.parse(fence[1]) };
    } catch {}
  }
  // Also try think+fence.
  const fence2 = sansThink.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence2) {
    try {
      return { shape: "json_after_fence_strip", parsedJson: JSON.parse(fence2[1]) };
    } catch {}
  }
  if (s.startsWith("```") || s.includes("```json")) return { shape: "markdown_fenced", parsedJson: null };
  if (s.includes("{")) return { shape: "preamble", parsedJson: null };
  return { shape: "plain_text", parsedJson: null };
}

async function probe(model: string, label: string, body: Record<string, unknown>): Promise<Result> {
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    if (!resp.ok) {
      return {
        model,
        config: label,
        http_ok: false,
        http_status: resp.status,
        http_error: (await resp.text()).slice(0, 200),
        url_count_in_content: 0,
        response_top_level_citations: 0,
        response_search_results: 0,
        message_citations: 0,
        message_annotations: 0,
        response_keys: [],
        message_keys: [],
        mentions_death: false,
      };
    }
    const data = (await resp.json()) as any;
    const choice = data.choices?.[0];
    const msg = choice?.message ?? {};
    const content: string = msg.content ?? "";
    const { shape, parsedJson } = classify(content);
    const findings = parsedJson?.findings ?? content;

    return {
      model,
      config: label,
      http_ok: true,
      finish_reason: choice?.finish_reason,
      content_shape: shape,
      parsed_findings_first_200: typeof findings === "string" ? findings.slice(0, 200) : undefined,
      parsed_correction_needed: parsedJson?.correction_needed,
      url_count_in_content: countUrls(typeof findings === "string" ? findings : content),
      response_top_level_citations: (data.citations ?? []).length,
      response_search_results: (data.search_results ?? []).length,
      message_citations: (msg.citations ?? []).length,
      message_annotations: (msg.annotations ?? []).length,
      response_keys: Object.keys(data),
      message_keys: Object.keys(msg),
      mentions_death: /\b(died|killed|assass|shot|deceased|dead)\b/i.test(findings) ||
                      /\b(died|killed|assass|shot|deceased)\b/i.test(content),
      prompt_tokens: data.usage?.prompt_tokens,
      completion_tokens: data.usage?.completion_tokens,
      reported_cost_usd: data.usage?.cost,
      raw_first_400: content.slice(0, 400),
    };
  } catch (err: any) {
    return {
      model,
      config: label,
      http_ok: false,
      http_error: err?.message?.slice(0, 200),
      url_count_in_content: 0,
      response_top_level_citations: 0,
      response_search_results: 0,
      message_citations: 0,
      message_annotations: 0,
      response_keys: [],
      message_keys: [],
      mentions_death: false,
    };
  }
}

function buildBody(model: string, kind: "A" | "D" | "E"): Record<string, unknown> {
  const userContent = kind === "D" ? USER_MESSAGE + JSON_INSTRUCTION : USER_MESSAGE;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  };
  if (kind === "A") body.response_format = JSON_SCHEMA_FORMAT;
  return body;
}

async function main(): Promise<void> {
  const models = ["perplexity/sonar-pro", "perplexity/sonar-reasoning-pro"] as const;
  const configs: Array<{ kind: "A" | "D" | "E"; label: string }> = [
    { kind: "A", label: "A. response_format=json_schema (current prod)" },
    { kind: "D", label: "D. no response_format + JSON instruction in prompt" },
    { kind: "E", label: "E. no response_format, no JSON instruction (control)" },
  ];

  const results: Result[] = [];
  for (const model of models) {
    for (const cfg of configs) {
      console.log(`Probing ${model}  ${cfg.label}`);
      results.push(await probe(model, cfg.label, buildBody(model, cfg.kind)));
    }
  }

  const outPath = join(__dirname, "probe_results.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${outPath}\n`);

  console.log(
    "model".padEnd(32) +
      "config".padEnd(50) +
      "shape".padEnd(28) +
      "URLs ✓death cite sr msg.c cost",
  );
  console.log("-".repeat(150));
  for (const r of results) {
    const cost = r.reported_cost_usd != null ? `$${r.reported_cost_usd.toFixed(4)}` : "-";
    const death = r.mentions_death ? "✓" : "✗";
    console.log(
      r.model.padEnd(32) +
        r.config.padEnd(50) +
        String(r.content_shape ?? "-").padEnd(28) +
        `${String(r.url_count_in_content).padStart(4)} ${death.padEnd(5)} ${String(r.response_top_level_citations).padStart(4)} ${String(r.response_search_results).padStart(2)} ${String(r.message_citations).padStart(5)} ${cost}`,
    );
    if (!r.http_ok) {
      console.log(`    ↳ HTTP ${r.http_status ?? "ERR"}: ${r.http_error?.slice(0, 150)}`);
    }
  }

  console.log(
    "\nLegend: shape=parsed shape; URLs=URLs in findings text; ✓death=mentions Kirk's death (true answer); " +
      "cite=response.citations.length; sr=response.search_results.length; msg.c=message.citations.length",
  );

  // Surface response-object keys, in case Perplexity hides citations somewhere unexpected.
  console.log("\nResponse-object keys per (model, config):");
  for (const r of results) {
    console.log(`  ${r.model}  ${r.config}`);
    console.log(`    response keys: ${r.response_keys.join(", ")}`);
    console.log(`    message keys:  ${r.message_keys.join(", ")}`);
  }
}

main();
