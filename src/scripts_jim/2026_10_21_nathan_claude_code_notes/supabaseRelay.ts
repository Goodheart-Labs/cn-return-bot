// Passes HTTP requests from port 8009 on to the local Supabase on port 54321.
// The permanent tunnel to Jim's Mac forwards 8009 but not 54321, so the local
// rerun's extension and website reach the local database through this relay
// (GOO-495). Realtime is not relayed, because it needs a websocket.
//
// Usage: mac-tunnel serve 8009 bun run src/scripts_jim/2026_10_21_nathan_claude_code_notes/supabaseRelay.ts

const RELAY_PORT = 8009;
const LOCAL_SUPABASE = "http://127.0.0.1:54321";

Bun.serve({
  port: RELAY_PORT,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    const upstream = await fetch(`${LOCAL_SUPABASE}${url.pathname}${url.search}`, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
    });
    // Bun has already decoded a compressed answer, so its length and encoding
    // headers no longer describe the body we pass on.
    const headers = new Headers(upstream.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
});
console.log(`relaying ${RELAY_PORT} to ${LOCAL_SUPABASE}`);
