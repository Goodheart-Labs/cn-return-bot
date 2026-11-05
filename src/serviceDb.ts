/* The typed database client with the service key, for code that runs on our
 * own machines: the Claude note writer and every notewriter that uses the
 * notewriter protocol (src/notewriters/). Never use it in a browser. */

import * as path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";
import { ENV_DIR } from "./cnEnv";
import type { Database } from "./everything-core/database.types";

let client: SupabaseClient<Database> | undefined;

export function db(): SupabaseClient<Database> {
  if (!client) {
    loadDotenv({ path: path.join(ENV_DIR, ".env"), quiet: true });
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in the root .env");
    client = createClient<Database>(url, key);
  }
  return client;
}
