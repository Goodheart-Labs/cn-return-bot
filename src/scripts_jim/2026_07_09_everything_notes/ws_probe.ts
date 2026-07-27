// Raw realtime-protocol probe: join a channel with a postgres_changes binding
// and print every frame the server sends, to see how registration is handled.
const KEY = process.env.PROBE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const ws = new WebSocket(`ws://127.0.0.1:54321/realtime/v1/websocket?apikey=${KEY}&vsn=1.0.0`);

ws.onopen = () => {
  ws.send(
    JSON.stringify({
      topic: "realtime:wsprobe",
      event: "phx_join",
      payload: {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: "" },
          postgres_changes: [{ event: "*", schema: "public", table: "everything_items" }],
        },
        access_token: KEY,
      },
      ref: "1",
    }),
  );
};
ws.onmessage = (e) => console.log(String(e.data).slice(0, 500));
ws.onerror = (e) => console.log("ws error", e);
setTimeout(() => process.exit(0), 20_000);
