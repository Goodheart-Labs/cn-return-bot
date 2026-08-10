import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// server.ts injects the Supabase credentials into the page at runtime. There is
// no build-time fallback, so the dashboard only works when it is served through
// server.ts.
const config = (window as any).__SUPABASE_CONFIG__;
const url = config?.url;
const key = config?.key;

if (!url || !key) {
  throw new Error("Missing Supabase credentials — must be served via server.ts");
}

export const supabase: SupabaseClient = createClient(url, key);
