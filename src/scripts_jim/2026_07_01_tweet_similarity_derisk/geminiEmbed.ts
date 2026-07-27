/**
 * Batch text embeddings via Google `gemini-embedding-2` (REST batchEmbedContents).
 * 3072-dim native, MRL-truncated to 1536. Free key first, paid fallback on quota
 * — mirrors the key-rotation in src/pipeline/llm/gemini.ts.
 */

export const EMBED_MODEL = "gemini-embedding-2";
export const EMBED_DIMS = 1536;
const TASK_TYPE = "SEMANTIC_SIMILARITY";
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 2000;

type Tier = "free" | "paid";

function geminiKeys(): { apiKey: string; tier: Tier }[] {
  const keys: { apiKey: string; tier: Tier }[] = [];
  if (process.env.GEMINI_API_KEY_FREE) keys.push({ apiKey: process.env.GEMINI_API_KEY_FREE, tier: "free" });
  if (process.env.GEMINI_API_KEY) keys.push({ apiKey: process.env.GEMINI_API_KEY, tier: "paid" });
  if (!keys.length) throw new Error("Set GEMINI_API_KEY and/or GEMINI_API_KEY_FREE");
  return keys;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const endpoint = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${key}`;

/** Embed up to ~100 texts; returns one vector per input, in order. */
export async function batchEmbed(texts: string[]): Promise<number[][]> {
  const body = {
    requests: texts.map((text) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBED_DIMS,
      taskType: TASK_TYPE,
    })),
  };

  const keys = geminiKeys();
  let lastErr: unknown;

  for (const { apiKey, tier } of keys) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(endpoint(apiKey), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 429) {
          lastErr = new Error(`quota (429) on ${tier} key`);
          break; // fall through to next key
        }
        if (res.status >= 500 || res.status === 408) {
          lastErr = new Error(`transient ${res.status} on ${tier} key`);
          if (attempt < MAX_RETRIES) {
            await sleep(BASE_BACKOFF_MS * 2 ** attempt);
            continue;
          }
          break;
        }
        if (!res.ok) throw new Error(`embed failed ${res.status}: ${await res.text()}`);
        const json = (await res.json()) as { embeddings: { values: number[] }[] };
        return json.embeddings.map((e) => e.values);
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_BACKOFF_MS * 2 ** attempt);
          continue;
        }
        break;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Cosine similarity of two equal-length vectors (1 = identical). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
