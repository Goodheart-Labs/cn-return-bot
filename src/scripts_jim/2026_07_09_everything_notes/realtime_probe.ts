// Subscribe to everything_* changes as the ANON role and print events for 60s.
// Verifies the frontend's realtime path end-to-end while the worker writes.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "http://127.0.0.1:54321",
  process.env.PROBE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
);

const channel = supabase
  .channel("probe")
  .on("postgres_changes", { event: "*", schema: "public", table: "everything_items" }, (p) =>
    console.log(`[items] ${p.eventType} ${(p.new as any)?.title ?? (p.new as any)?.id ?? ""} status=${(p.new as any)?.status ?? ""}`),
  )
  .on("postgres_changes", { event: "*", schema: "public", table: "everything_claims" }, (p) =>
    console.log(`[claims] ${p.eventType} status=${(p.new as any)?.status ?? ""} claim="${((p.new as any)?.claim ?? "").slice(0, 60)}"`),
  )
  .on("postgres_changes", { event: "*", schema: "public", table: "everything_notes" }, (p) =>
    console.log(`[notes] ${p.eventType} note="${((p.new as any)?.note ?? "").slice(0, 80)}"`),
  )
  .subscribe((status, err) => console.log(`subscription: ${status}${err ? ` err=${err.message}` : ""}`));

setTimeout(async () => {
  await supabase.removeChannel(channel);
  process.exit(0);
}, 60_000);
