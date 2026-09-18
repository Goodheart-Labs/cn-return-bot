import { describe, expect, test } from "bun:test";
import { startOperatorEndpoint } from "./operator";
import type { IncomingMessage } from "./transport";

describe("operator endpoint", () => {
  test("announces the labelled line, feeds it to the engine, and returns the replies it caused", async () => {
    const sent: string[] = [];
    const handled: IncomingMessage[] = [];
    const endpoint = startOperatorEndpoint({
      port: 0,
      announce: async (text, group) => { sent.push(group ? `[${group}] ${text}` : text); },
      handle: async message => { handled.push(message); sent.push(`Bot: reply to ${message.text}`); },
      sent: () => sent,
    });
    try {
      const base = `http://127.0.0.1:${endpoint.port}`;
      const first = await fetch(`${base}/message`, { method: "POST", body: JSON.stringify({ text: " hello " }) });
      expect(await first.json()).toEqual({ replies: ["Claude: hello", "Bot: reply to hello"] });
      expect(handled[0]).toMatchObject({ sender: "operator", text: "hello", mentionsBot: true });
      expect(handled[0]!.id).toBe(`operator:${handled[0]!.timestamp}`);

      const quiet = await fetch(`${base}/message`, { method: "POST", body: JSON.stringify({ text: "status", announce: false }) });
      expect(await quiet.json()).toEqual({ replies: ["Bot: reply to status"] });
      expect(handled[1]!.timestamp).toBeGreaterThan(handled[0]!.timestamp);

      const sayOnly = await fetch(`${base}/message`, { method: "POST", body: JSON.stringify({ text: "re-running the links", handle: false }) });
      expect(await sayOnly.json()).toEqual({ replies: ["Claude: re-running the links"] });
      expect(handled).toHaveLength(2);
      const elsewhere = await fetch(`${base}/message`, { method: "POST", body: JSON.stringify({ text: "nice note", group: "live" }) });
      expect(await elsewhere.json()).toEqual({ replies: ["[live] Claude: nice note"] });
      expect(handled).toHaveLength(2);
      const empty = await fetch(`${base}/message`, { method: "POST", body: "{}" });
      expect(empty.status).toBe(400);
      const later = await fetch(`${base}/replies?since=2`);
      expect(await later.json()).toEqual({ replies: ["Bot: reply to status", "Claude: re-running the links", "[live] Claude: nice note"], cursor: 5 });
      expect((await fetch(`${base}/nope`)).status).toBe(404);
    } finally {
      endpoint.stop();
    }
  });
});
