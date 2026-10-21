// Runs the worker's own item processing on every queued item of the local
// Supabase, a few items at a time (GOO-495). The worker itself takes one item
// after another, and its claim of the next item is not atomic, so several
// workers side by side could take the same item. This runner hands each item
// to exactly one call instead.
//
// It must only ever run against the local Supabase. It refuses any other URL.
//
// Usage: source the local env, then
//   bun run src/scripts_jim/2026_10_21_nathan_claude_code_notes/runItems.ts

import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";
import { closeBrowser } from "../../pipeline/utils/browserManager";
import type { EverythingItem } from "../../everything/db";
import { processQueuedItem } from "../../everything/worker";
import { ensureYtDlp } from "../../everything/sources/youtube";

const ITEMS_AT_A_TIME = 4;
const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";

if (process.env.SUPABASE_URL !== LOCAL_SUPABASE_URL) throw new Error(`SUPABASE_URL must be ${LOCAL_SUPABASE_URL}`);

const db = getSupabaseClient();
const { data: items, error } = await db.from("everything_items").select("*").eq("status", "queued");
if (error) throw error;
console.log(`${items.length} queued items`);

ensureYtDlp();
const waiting = [...(items as EverythingItem[])];

async function runLane() {
  for (let item = waiting.shift(); item; item = waiting.shift()) {
    await db.from("everything_items").update({ status: "processing" }).eq("id", item.id);
    const outcome = await processQueuedItem({ ...item, status: "processing" });
    console.log(`[runItems] ${item.url}: ${JSON.stringify(outcome)}`);
  }
}

await Promise.all(Array.from({ length: ITEMS_AT_A_TIME }, runLane));
await closeBrowser();
