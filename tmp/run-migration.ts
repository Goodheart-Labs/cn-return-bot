import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const sql = readFileSync("migrations/009_add_tweet_id_to_snapshots.sql", "utf-8");

// Run each statement separately
const statements = sql
  .split(";")
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith("--"));

for (const stmt of statements) {
  console.log("Running:", stmt.slice(0, 80) + "...");
  const { error } = await client.rpc("exec_sql", { sql: stmt });
  if (error) {
    // Try via REST if rpc not available
    console.log("  rpc failed, trying direct...", error.message);
  } else {
    console.log("  OK");
  }
}
