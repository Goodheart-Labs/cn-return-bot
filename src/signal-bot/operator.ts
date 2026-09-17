import type { IncomingMessage } from "./transport";

interface OperatorDependencies {
  /** Loopback only. 0 picks a free port. */
  port: number;
  /** Posts the operator's own line, labelled, so the group sees who asked. `group` names another group. */
  announce: (text: string, group?: string) => Promise<unknown>;
  handle: (message: IncomingMessage) => Promise<void>;
  /** Everything the bot has sent, in order; the endpoint returns the slice after each request. */
  sent: () => readonly string[];
  label?: string;
}

/** A local HTTP door for whoever operates the bot from a terminal (Claude, mostly).
 * POST /message {"text": "..."} announces the line in the group as "<label>: ..." and
 * then feeds it to the engine as an ordinary message, returning the replies it produced.
 * Pass "announce": false to feed silently, or "handle": false to only say something.
 * GET /replies?since=N returns later sends. */
export function startOperatorEndpoint(dependencies: OperatorDependencies) {
  let last = 0;
  const tick = () => (last = Math.max(Date.now(), last + 1));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: dependencies.port,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/message") {
        const body = await request.json().catch(() => null) as { text?: unknown; announce?: unknown; handle?: unknown; group?: unknown } | null;
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (!text) return Response.json({ error: "text is required" }, { status: 400 });
        const group = typeof body?.group === "string" && body.group.trim() ? body.group.trim() : undefined;
        const before = dependencies.sent().length;
        if (body?.announce !== false) await dependencies.announce(`${dependencies.label ?? "Claude"}: ${text}`, group);
        // "handle": false posts the operator's line without treating it as a request.
        // Only the main group's requests reach the engine.
        if (body?.handle === false || group) return Response.json({ replies: dependencies.sent().slice(before) });
        const timestamp = tick();
        // The operator is always addressing the bot, so mention-only mode lets it through.
        await dependencies.handle({ id: `operator:${timestamp}`, sender: "operator", timestamp, text, mentionsBot: true });
        return Response.json({ replies: dependencies.sent().slice(before) });
      }
      if (request.method === "GET" && url.pathname === "/replies") {
        const since = Number(url.searchParams.get("since") ?? 0);
        const all = dependencies.sent();
        return Response.json({ replies: all.slice(Number.isSafeInteger(since) && since >= 0 ? since : 0), cursor: all.length });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  return { port: server.port, stop: () => server.stop(true) };
}
