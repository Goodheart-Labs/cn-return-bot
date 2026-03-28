import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Runtime injection from server.ts takes priority over vite build-time values
const config = (window as any).__SUPABASE_CONFIG__;
const url = config?.url;
const key = config?.key;

if (!url || !key) {
  throw new Error("Missing Supabase credentials — must be served via server.ts");
}

export const supabase: SupabaseClient = createClient(url, key);
