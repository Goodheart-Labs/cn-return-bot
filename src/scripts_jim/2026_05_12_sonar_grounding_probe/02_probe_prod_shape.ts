/**
 * Reproduce the actual production prompt that caused sonar-reasoning-pro to
 * miss the fact that Charlie Kirk is dead.
 *
 * The first probe (`01_probe_sonar_grounding.ts`) used a short prompt that
 * explicitly asked "is Charlie Kirk dead?" — and ALL configs (including
 * current prod) correctly grounded the answer in web search. So the
 * earlier "sonar isn't grounding" diagnosis was wrong.
 *
 * Hypothesis being tested here: when the production prompt includes a
 * dense video transcript that itself describes Charlie Kirk in present
 * tense ("Charlie was learning… he'd finish lectures"), sonar anchors on
 * that in-prompt evidence and skips the web search. The prompt itself
 * suppresses grounding.
 *
 * If that's the cause, the fix is prompt-shape, not response_format:
 *   - Either remove the video transcript from the search prompt
 *   - Or add an explicit "verify time-sensitive claims via search even
 *     when the post provides context"
 *
 * This probe sends the same production prompt to both sonar models in
 * three configs and inspects: does the response mention Kirk's death? Does
 * it include URLs in the text?
 *
 * Run from repo root:
 *   bun run src/scripts_jim/2026_05_12_sonar_grounding_probe/02_probe_prod_shape.ts
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

// VERBATIM from src/pipeline/simple-bot/searchDispatch.ts
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
- When the "error" is too minor or pedantic

## Sourcing rules
- Tweets and tweet replies from the comments are valid sources and can be included in the findings (include full x.com URL).
- Include what each source says that's relevant.
- If no correction is needed, the findings can be brief — just explain why.`;

// EXACTLY the production user message from the failed run.
const PROD_USER_MESSAGE = `Current date: 2026-05-10
Current time: 05:16 UTC
Tweet posted: 2026-05-09T20:54:38.000Z
Tweet URL: https://x.com/i/status/2053217102312456605

Author: Marlene Robertson🇨🇦 — 117,961 followers — 51,273 posts
Author bio: A Secular Humanist Defending Democracy who will never Obey in Advance💙I have Severe TDS and Proud of it💙The only good Nazi is a dead Nazis💙WokeAF 🚫DM
Engagement: 98,033 impressions — 3,379 likes — 671 retweets — 951 replies — 94 quotes

## Post

Erika Kirk, who runs a white nationalist religious cult,  just received an Honorary Doctorate on behalf of her dead racist podcaster husband.   I'm fucking speechless.  https://t.co/jrZnmmhmYC

## Media on post

### Video 1
Description: A graduate in academic regalia is seen at a Hillsdale College ceremony, followed by several wide-angle views of the large graduating class and audience seated in a large indoor venue.
Visible text: HILLSDALE COLLEGE
PURSUING TRUTH LIBERATING SINCE 1844
Audio transcript: Thank you. First, I want to say thank you to Dr. Arnn, your beautiful wife, Penny. You guys have been there for me during the darkest moments of my life. So thank you for that. To all of you here, parents, class of 2026, faculty and staff, it's an honor to be here. It's an honor to accept the degrees that I'll be receiving later on behalf of myself and Charlie. on a lighter note yesterday was my wedding anniversary and I couldn't help but think of a funny story to share with you through obviously a lot of pain but when we got married and we went to our honeymoon the next day we decided for our honeymoon that that it would be a disconnected honeymoon, meaning no computers, no cell phones, just being able to pour into each other, plan out what our family life would look like what type of parents we want to be what type of spouse we want to be So really just pour into each other And so again no phones But at the time Charlie assistant gave Charlie a bat phone for emergencies. So there was only emergency phone numbers on this phone, nothing else. So when we arrive, we go straight to the gym because that's what we did. and I'm on one side of the gym, Charlie's on the other, and then all of a sudden I was thinking he pulled out the bat phone. And I was like, okay, maybe he's going to put on some music. He loved classic rock. I was like, maybe he's going to put on some music. So I'm on the treadmill, he's over in the weights, and all of a sudden I hear Dr. Arndt's voice coming from the side of the room. And so I walk over to him, and I was like, baby, what are you listening to? He goes, I know. He was like, I'm almost done. He's like, I have to finish just a few more lectures from Dr. Arnn. I have a few more certificates I have to get from my online courses at Hillsdale. We're almost there. I can't skip them. I was like, baby, you do what you got to do. I'm here for it. But I enjoyed it because I was learning about Churchill, too, when he was working out. I was working out. It was a great little bonding moment. But every time Charlie finished a Hillsdale program, he would online, he would screenshot the certificate of completion, and he would send them to me every time. I know he would send them to the team as well. I believe he also sent them.

## Comments and replies

- **Kes Bretagne - @KesendraB**: Fake degree from a fake college. Engagement: Likes=92, Reposts=3, Quotes=0, Replies=0, Bookmarks=0, Views=757
- **Kristen - @kristengough**: @Hillsdale Shameful! Christian Nationalism is not Christianity. Kirk spread hateful rhetoric… bad move. Just wow 🤦🏼‍♀️🤦🏼‍♀️🤦🏼‍♀️💩💩💩 Engagement: Likes=91, Reposts=10, Quotes=1, Replies=2, Bookmarks=0, Views=1292
- **Tiff4Mahogany_44 🇺🇸 🇺🇦 NATO MEMBER - @tiff4mahogany**: I thought this movement abhorred receiving something you didn't earn? Engagement: Likes=42, Reposts=10, Quotes=0, Replies=3, Bookmarks=1, Views=767
- **Jim Hanson - @JimHansonDC**: "I'm f-ing speechless." Sadly you are not. It would be a vast improvement to the public discourse if you were rather than smearing a dead patriot and his widow. Engagement: Likes=29, Reposts=2, Quotes=0, Replies=1, Bookmarks=0, Views=1011`;

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

// New: a hardened system prompt that pushes the model to verify in-prompt context.
const HARDENED_SYSTEM_PROMPT = SEARCH_SYSTEM_PROMPT + `

## Critical: verify in-prompt evidence
The post text, media transcripts, and comments are NOT primary sources of truth.
Treat them as the *claim being investigated*. ALWAYS run web searches to verify
time-sensitive facts (deaths, current events, recent news) even when the in-prompt
context appears to support them. People described in the post may have died,
changed jobs, retracted statements, etc. since the in-prompt content was
written — verify with live search.`;

interface Result {
  model: string;
  config: string;
  http_ok: boolean;
  http_status?: number;
  http_error?: string;
  shape: string;
  findings_first_300: string;
  correction_needed?: boolean;
  url_count: number;
  mentions_death: boolean;
  /** Did the model fall for the in-prompt "Charlie is alive" framing? */
  fell_for_in_prompt: boolean;
  cost_usd?: number;
  completion_tokens?: number;
}

function countUrls(s: string): number {
  if (!s) return 0;
  const m = s.match(/https?:\/\/(?!t\.co\/|x\.com\/)\S+/g);  // exclude t.co + x.com self-refs
  return m ? new Set(m.map((u) => u.replace(/[).,;]+$/, ""))).size : 0;
}

function classify(content: string): { shape: string; parsed: any | null } {
  const s = content.trim();
  if (!s) return { shape: "empty", parsed: null };
  try { return { shape: "json", parsed: JSON.parse(s) }; } catch {}
  const sansThink = s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (sansThink !== s) {
    try { return { shape: "json_after_think_strip", parsed: JSON.parse(sansThink) }; } catch {}
  }
  const fence = sansThink.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return { shape: "json_after_fence_strip", parsed: JSON.parse(fence[1]) }; } catch {}
  }
  return { shape: "plain_text", parsed: null };
}

async function probe(model: string, label: string, body: Record<string, unknown>): Promise<Result> {
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) {
      return {
        model, config: label, http_ok: false,
        http_status: resp.status,
        http_error: (await resp.text()).slice(0, 200),
        shape: "error",
        findings_first_300: "",
        url_count: 0, mentions_death: false, fell_for_in_prompt: false,
      };
    }
    const data = (await resp.json()) as any;
    const content: string = data.choices?.[0]?.message?.content ?? "";
    const { shape, parsed } = classify(content);
    const findings: string = (parsed?.findings ?? content) as string;
    const mentions_death = /\b(died|killed|assass|shot|deceased|posthumous(ly)?|murdered)\b/i.test(findings);
    // "Fell for in-prompt" = model concluded correction_needed=true based on the post's "dead husband" claim
    // being supposedly wrong, OR finding text describes Kirk as alive.
    const claims_alive = /charlie.*(?:alive|completing|active|currently|finishing)|currently.*charlie|charlie.*\b(is|works|enrolls)\b/i.test(findings);
    return {
      model, config: label, http_ok: true, shape,
      findings_first_300: findings.slice(0, 300),
      correction_needed: parsed?.correction_needed,
      url_count: countUrls(findings),
      mentions_death,
      fell_for_in_prompt: parsed?.correction_needed === true && !mentions_death,
      cost_usd: data.usage?.cost,
      completion_tokens: data.usage?.completion_tokens,
    };
  } catch (err: any) {
    return {
      model, config: label, http_ok: false,
      http_error: err?.message?.slice(0, 200),
      shape: "error",
      findings_first_300: "",
      url_count: 0, mentions_death: false, fell_for_in_prompt: false,
    };
  }
}

interface Cfg { kind: "A" | "D" | "A_HARDENED" | "D_HARDENED"; label: string }
const CONFIGS: Cfg[] = [
  { kind: "A", label: "A. response_format=json_schema (PROD)" },
  { kind: "D", label: "D. no response_format + prompted JSON" },
  { kind: "A_HARDENED", label: "A+hardened-sys-prompt" },
  { kind: "D_HARDENED", label: "D+hardened-sys-prompt" },
];

function buildBody(model: string, kind: Cfg["kind"]): Record<string, unknown> {
  const isHardened = kind.endsWith("HARDENED");
  const sys = isHardened ? HARDENED_SYSTEM_PROMPT : SEARCH_SYSTEM_PROMPT;
  const userKind = kind.startsWith("D") ? "D" : "A";
  const userContent = userKind === "D" ? PROD_USER_MESSAGE + JSON_INSTRUCTION : PROD_USER_MESSAGE;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userContent },
    ],
  };
  if (userKind === "A") body.response_format = JSON_SCHEMA_FORMAT;
  return body;
}

async function main(): Promise<void> {
  const models = ["perplexity/sonar-pro", "perplexity/sonar-reasoning-pro"] as const;
  const results: Result[] = [];
  for (const model of models) {
    for (const cfg of CONFIGS) {
      console.log(`Probing ${model}  ${cfg.label}`);
      results.push(await probe(model, cfg.label, buildBody(model, cfg.kind)));
    }
  }

  writeFileSync(join(__dirname, "probe_results_prod_shape.json"), JSON.stringify(results, null, 2));

  console.log(
    "\n" +
      "model".padEnd(33) +
      "config".padEnd(43) +
      "shape".padEnd(26) +
      "URLs ✓death  cn  cost",
  );
  console.log("-".repeat(130));
  for (const r of results) {
    const cost = r.cost_usd != null ? `$${r.cost_usd.toFixed(4)}` : "-";
    const death = r.mentions_death ? "✓" : "✗";
    const cn = r.correction_needed == null ? "-" : r.correction_needed ? "T" : "F";
    console.log(
      r.model.padEnd(33) +
        r.config.padEnd(43) +
        r.shape.padEnd(26) +
        `${String(r.url_count).padStart(4)} ${death.padEnd(5)}    ${cn}  ${cost}`,
    );
    if (r.fell_for_in_prompt) {
      console.log(`    ⚠ FELL FOR IN-PROMPT: correction_needed=true but didn't surface his death`);
    }
  }

  console.log("\n=== Findings excerpts (first 300 chars) ===");
  for (const r of results) {
    console.log(`\n[${r.model}  ${r.config}]`);
    console.log(`  ${r.findings_first_300}`);
  }
}

main();
