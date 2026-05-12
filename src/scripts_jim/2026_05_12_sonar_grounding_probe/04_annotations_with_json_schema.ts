/**
 * Check whether `message.annotations[*].url_citation` is still populated
 * when we use `response_format: json_schema` (current prod config) with
 * the full production-shape prompt that includes the video transcript.
 *
 * Probe 03 showed annotations are populated under json_schema with a
 * short prompt. The remaining question: does the in-prompt anchoring
 * problem also suppress annotations, or do annotations stay good even
 * when the model's *conclusion* is wrong?
 *
 * If annotations stay good: that's a meaningful escape hatch — even when
 * sonar is fooled by the in-prompt transcript, we still get real URLs
 * we can pass to the note-writer.
 *
 * Run from repo root:
 *   bun run src/scripts_jim/2026_05_12_sonar_grounding_probe/04_annotations_with_json_schema.ts
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

const SEARCH_SYSTEM_PROMPT = `You are a research agent for Community Notes fact-checking on X/Twitter.

Your job: investigate whether the post below contains a factual error that would benefit from a community note. Use the web_search tool to find evidence.

## Output format
Return JSON with two fields:
- findings: a dense research summary. Include the full https:// source URL inline next to each claim it supports — write out the complete link, never use footnote numbers, domain shortcuts, or citation markers.
- correction_needed: true only if the post contains a clear factual error supported by direct contradicting evidence.

## When NOT to set correction_needed = true
- Opinions, satire, jokes, hyperbole
- Posts that are factually correct
- When you can't find strong contradicting evidence
- When the "error" is too minor or pedantic`;

// Full production prompt from the failed run.
const PROD_USER_MESSAGE = `Current date: 2026-05-10
Current time: 05:16 UTC
Tweet posted: 2026-05-09T20:54:38.000Z
Tweet URL: https://x.com/i/status/2053217102312456605

Author: Marlene Robertson🇨🇦 — 117,961 followers — 51,273 posts

## Post

Erika Kirk, who runs a white nationalist religious cult, just received an Honorary Doctorate on behalf of her dead racist podcaster husband. I'm fucking speechless. https://t.co/jrZnmmhmYC

## Media on post

### Video 1
Description: A graduate in academic regalia is seen at a Hillsdale College ceremony.
Audio transcript: Thank you. First, I want to say thank you to Dr. Arnn, your beautiful wife, Penny. You guys have been there for me during the darkest moments of my life. So thank you for that. To all of you here, parents, class of 2026, faculty and staff, it's an honor to be here. It's an honor to accept the degrees that I'll be receiving later on behalf of myself and Charlie. on a lighter note yesterday was my wedding anniversary and I couldn't help but think of a funny story to share with you through obviously a lot of pain. When we got married and we went to our honeymoon the next day we decided for our honeymoon that that it would be a disconnected honeymoon. So when we arrive, we go straight to the gym because that's what we did. and I'm on one side of the gym, Charlie's on the other, and then all of a sudden I was thinking he pulled out the bat phone. So I'm on the treadmill, he's over in the weights, and all of a sudden I hear Dr. Arndt's voice coming from the side of the room. And so I walk over to him, and I was like, baby, what are you listening to? He goes, I know. He was like, I'm almost done. He's like, I have to finish just a few more lectures from Dr. Arnn. I have a few more certificates I have to get from my online courses at Hillsdale. But every time Charlie finished a Hillsdale program, he would online, he would screenshot the certificate of completion, and he would send them to me every time.

## Comments and replies

- **Kes Bretagne - @KesendraB**: Fake degree from a fake college.
- **Jim Hanson - @JimHansonDC**: "I'm f-ing speechless." Sadly you are not. It would be a vast improvement to the public discourse if you were rather than smearing a dead patriot and his widow.`;

const SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "search_findings",
    strict: true,
    schema: {
      type: "object",
      properties: {
        findings: { type: "string" },
        correction_needed: { type: "boolean" },
      },
      required: ["findings", "correction_needed"],
      additionalProperties: false,
    },
  },
};

interface Result {
  model: string;
  run: number;
  findings_first_200: string;
  correction_needed: boolean | null;
  annotation_count: number;
  annotations_have_death_source: boolean;
  annotations_sample: Array<{ url: string; title: string }>;
  mentions_death_in_findings: boolean;
  cost_usd: number;
}

const DEATH_HINTS = /\b(died|killed|assass|shot|deceased|obituary|charlie-kirk-dead|posthumous|memorial|murdered|in[- ]memoriam)\b/i;

async function probe(model: string, run: number): Promise<Result> {
  const body = {
    model,
    messages: [
      { role: "system", content: SEARCH_SYSTEM_PROMPT },
      { role: "user", content: PROD_USER_MESSAGE },
    ],
    response_format: SCHEMA,
  };
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = (await resp.json()) as any;
  const msg = data.choices?.[0]?.message ?? {};
  const content: string = msg.content ?? "";
  let parsed: any | null = null;
  try { parsed = JSON.parse(content); } catch {}
  const findings: string = parsed?.findings ?? content;
  const annotations = (msg.annotations ?? []).filter((a: any) => a.type === "url_citation");
  const annUrls: Array<{ url: string; title: string }> = annotations.map((a: any) => ({
    url: a.url_citation?.url ?? "",
    title: a.url_citation?.title ?? "",
  }));
  return {
    model,
    run,
    findings_first_200: findings.slice(0, 200),
    correction_needed: parsed?.correction_needed ?? null,
    annotation_count: annotations.length,
    annotations_have_death_source: annUrls.some((a) => DEATH_HINTS.test(a.url) || DEATH_HINTS.test(a.title)),
    annotations_sample: annUrls.slice(0, 6),
    mentions_death_in_findings: DEATH_HINTS.test(findings),
    cost_usd: data.usage?.cost ?? 0,
  };
}

async function main(): Promise<void> {
  const models = ["perplexity/sonar-pro", "perplexity/sonar-reasoning-pro"] as const;
  // Run each model 3 times to see non-determinism.
  const results: Result[] = [];
  for (const model of models) {
    for (let run = 1; run <= 3; run++) {
      console.log(`Probing ${model}  run ${run}/3`);
      try {
        results.push(await probe(model, run));
      } catch (err: any) {
        console.log(`  ERR: ${err?.message?.slice(0, 200)}`);
      }
    }
  }

  writeFileSync(join(__dirname, "annotations_under_json_schema.json"), JSON.stringify(results, null, 2));

  console.log(
    "\n" +
      "model".padEnd(33) +
      "run".padEnd(6) +
      "ann".padEnd(6) +
      "ann_has_death".padEnd(16) +
      "findings_says_death".padEnd(22) +
      "cn  cost",
  );
  console.log("-".repeat(110));
  for (const r of results) {
    const annDeath = r.annotations_have_death_source ? "✓" : "✗";
    const findDeath = r.mentions_death_in_findings ? "✓" : "✗";
    const cn = r.correction_needed === null ? "-" : r.correction_needed ? "T" : "F";
    console.log(
      r.model.padEnd(33) +
        String(r.run).padEnd(6) +
        String(r.annotation_count).padEnd(6) +
        annDeath.padEnd(16) +
        findDeath.padEnd(22) +
        `${cn}  $${r.cost_usd.toFixed(4)}`,
    );
  }

  console.log("\n=== Sample annotations per run (URL — title) ===");
  for (const r of results) {
    console.log(`\n[${r.model} run ${r.run}]  ann=${r.annotation_count}  findings_first_200:`);
    console.log(`  ${r.findings_first_200}`);
    for (const a of r.annotations_sample) {
      console.log(`  • ${a.url}  —  ${a.title.slice(0, 70)}`);
    }
  }
}

main();
