// Replays the exact writer call of an empty-note run against OpenRouter and
// prints the raw reply: finish reason, message keys, content, reasoning, usage.
// This tells apart "the model chose an empty note" from "the reply carried
// something the code threw away".
//
//   bun run src/scripts_jim/2026_09_16_empty_note_card/replay_writer.ts [runIdPrefix ...] [--repeat N]
//
// Uses OPENROUTER_TESTING_KEY from .env (the main key answers 401 locally).
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
  }),
);
const key = env.OPENROUTER_TESTING_KEY;
if (!key) throw new Error("OPENROUTER_TESTING_KEY missing");

const args = process.argv.slice(2);
const repeatIdx = args.indexOf("--repeat");
const repeat = repeatIdx >= 0 ? Number(args[repeatIdx + 1]) : 1;
const prefixes = args.filter((a, i) => a !== "--repeat" && i !== repeatIdx + 1);

const runs = JSON.parse(readFileSync("src/scripts_jim/2026_09_16_empty_note_card/data/empty_runs.json", "utf8"));
const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "simple_bot_note",
    strict: true,
    schema: {
      type: "object",
      properties: {
        note_text: { type: "string", description: "The community note body (do not include source URLs here; they go in `sources`)." },
        sources: { type: "array", items: { type: "string" }, description: "Full https:// URLs cited by the note." },
      },
      required: ["note_text", "sources"],
      additionalProperties: false,
    },
  },
};

for (const run of runs) {
  if (prefixes.length && !prefixes.some((p) => run.id.startsWith(p))) continue;
  const messages = run.logs.note_writer_steps.note_writer.attempts["0"].messages;
  const model = run.ab_test_picks.simple_bot_writer === "sonnet5" ? "anthropic/claude-sonnet-5" : "meta/muse-spark-1.3-contributor";
  const loggedOut = run.logs.costs.entries.find((e: any) => e.name === "note_writer.1")?.output_tokens;
  console.log(`\n===== run ${run.id.slice(0, 8)} (${run.created_at.slice(0, 10)}) model ${model}, logged output tokens ${loggedOut}`);
  for (let i = 0; i < repeat; i++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, response_format: RESPONSE_FORMAT, provider: { require_parameters: true } }),
    });
    const body: any = await res.json();
    const choice = body.choices?.[0];
    const msg = choice?.message ?? {};
    console.log(`--- try ${i + 1}: http ${res.status}, provider ${body.provider}, finish ${choice?.finish_reason}/${choice?.native_finish_reason}, message keys ${Object.keys(msg).join(",")}`);
    console.log("usage:", JSON.stringify(body.usage));
    if (body.error) console.log("error:", JSON.stringify(body.error).slice(0, 500));
    const content = msg.content;
    console.log(`content (${typeof content}, ${typeof content === "string" ? content.length : "?"} chars):`, typeof content === "string" ? content.slice(0, 700) : JSON.stringify(content)?.slice(0, 700));
    if (msg.reasoning) console.log("reasoning:", String(msg.reasoning).slice(0, 300));
    if (msg.refusal) console.log("refusal:", String(msg.refusal).slice(0, 300));
  }
}
