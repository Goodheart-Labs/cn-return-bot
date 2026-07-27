import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
try {
  const r = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16,
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
  });
  const text = r.content.map((b:any)=>b.type==="text"?b.text:"").join("");
  console.log("SUCCESS — key works and has credits.");
  console.log("model:", r.model, "| reply:", JSON.stringify(text.trim()), "| usage:", JSON.stringify(r.usage));
} catch (err:any) {
  console.log("FAILED");
  console.log("status:", err.status);
  console.log("message:", err.message?.slice(0,400));
  if (err.error) console.log("body:", JSON.stringify(err.error).slice(0,400));
}
process.exit(0);
