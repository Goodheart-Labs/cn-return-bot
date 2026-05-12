/**
 * Dump the ENTIRE raw OpenRouter response from sonar models under each
 * config so we can find where Perplexity stuffs its citations.
 *
 * Probe 01 looked at a fixed list of fields (response.citations,
 * search_results, message.citations, message.annotations) and found them
 * all empty. But OpenRouter and Perplexity have been adding fields over
 * time, and `message.annotations` showed up in the response key list as
 * a non-trivial array — maybe it has content I didn't unpack.
 *
 * This script writes one JSON file per (model, config) with the full
 * pretty-printed response, plus a summary that recursively scans for
 * any string field that looks like a URL or a citation.
 *
 * Run from repo root:
 *   bun run src/scripts_jim/2026_05_12_sonar_grounding_probe/03_dump_raw_response.ts
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

// Short prompt that DOES need fresh web data, so we can confirm the search
// step actually ran when citations appear.
const SYSTEM_PROMPT = "You are a fact-checking research agent. Cite sources.";
const USER_MESSAGE =
  "Is Charlie Kirk still alive as of 2026-05? Cite the full URLs of your sources.";

const SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "answer",
    strict: true,
    schema: {
      type: "object",
      properties: {
        answer: { type: "string" },
        sources: { type: "array", items: { type: "string" } },
      },
      required: ["answer", "sources"],
      additionalProperties: false,
    },
  },
};

interface Probe { model: string; label: string; body: Record<string, unknown> }

const PROBES: Probe[] = [
  {
    model: "perplexity/sonar-pro",
    label: "sonar-pro__no_response_format",
    body: {
      model: "perplexity/sonar-pro",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_MESSAGE },
      ],
    },
  },
  {
    model: "perplexity/sonar-pro",
    label: "sonar-pro__json_schema",
    body: {
      model: "perplexity/sonar-pro",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_MESSAGE },
      ],
      response_format: SCHEMA,
    },
  },
  {
    model: "perplexity/sonar-reasoning-pro",
    label: "sonar-reasoning-pro__no_response_format",
    body: {
      model: "perplexity/sonar-reasoning-pro",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_MESSAGE },
      ],
    },
  },
  {
    model: "perplexity/sonar-reasoning-pro",
    label: "sonar-reasoning-pro__json_schema",
    body: {
      model: "perplexity/sonar-reasoning-pro",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_MESSAGE },
      ],
      response_format: SCHEMA,
    },
  },
];

/** Walk the response tree, return any string that looks like a URL, with its path. */
function findUrls(node: any, path = ""): Array<{ path: string; url: string }> {
  const out: Array<{ path: string; url: string }> = [];
  if (typeof node === "string") {
    const urls = node.match(/https?:\/\/[^\s)"',]+/g);
    if (urls) for (const u of urls) out.push({ path, url: u });
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => out.push(...findUrls(v, `${path}[${i}]`)));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      out.push(...findUrls(v, path ? `${path}.${k}` : k));
    }
  }
  return out;
}

/** Walk the response tree, count each leaf key path that has a non-empty value. */
function leafPaths(node: any, path = ""): Array<{ path: string; type: string; preview: string }> {
  const out: Array<{ path: string; type: string; preview: string }> = [];
  if (node === null) {
    out.push({ path, type: "null", preview: "" });
  } else if (typeof node === "string") {
    if (node) out.push({ path, type: "string", preview: node.slice(0, 80) });
  } else if (typeof node === "number" || typeof node === "boolean") {
    out.push({ path, type: typeof node, preview: String(node) });
  } else if (Array.isArray(node)) {
    if (node.length === 0) out.push({ path, type: "array[]", preview: "empty" });
    else node.forEach((v, i) => out.push(...leafPaths(v, `${path}[${i}]`)));
  } else if (node && typeof node === "object") {
    if (Object.keys(node).length === 0) out.push({ path, type: "object{}", preview: "empty" });
    else for (const [k, v] of Object.entries(node)) out.push(...leafPaths(v, path ? `${path}.${k}` : k));
  }
  return out;
}

async function main(): Promise<void> {
  for (const p of PROBES) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Probing  ${p.label}`);
    console.log("=".repeat(80));
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(p.body),
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) {
        const text = await resp.text();
        console.log(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
        continue;
      }
      const data = await resp.json();
      const outPath = join(__dirname, `raw_${p.label}.json`);
      writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`raw response written to ${outPath}\n`);

      // Summary
      const urls = findUrls(data);
      console.log(`URL-bearing fields (${urls.length} URL refs found):`);
      const byPath: Record<string, number> = {};
      for (const { path } of urls) {
        // Normalize array indices so we count "buckets" not entries
        const norm = path.replace(/\[\d+\]/g, "[*]");
        byPath[norm] = (byPath[norm] ?? 0) + 1;
      }
      for (const [p, n] of Object.entries(byPath).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${p.padEnd(60)}  ${n}`);
      }

      // Show any non-trivially-empty leaf paths under message.* and top-level
      // (skip the content text — too big — and the usual id/model/created junk)
      const leaves = leafPaths(data);
      const interesting = leaves.filter((l) => {
        if (l.path.endsWith(".content") && l.type === "string") return false;
        if (l.path.startsWith("choices[0].message.reasoning") && l.type === "string") return false;
        if (/^(id|object|created|model|provider|system_fingerprint|usage\.)/.test(l.path)) return false;
        return true;
      });
      console.log(`\nNon-content leaves (${interesting.length}):`);
      for (const l of interesting) {
        console.log(`  ${l.path.padEnd(60)}  ${l.type.padEnd(10)}  ${l.preview}`);
      }
    } catch (err: any) {
      console.log(`ERR: ${err?.message?.slice(0, 200)}`);
    }
  }
}

main();
