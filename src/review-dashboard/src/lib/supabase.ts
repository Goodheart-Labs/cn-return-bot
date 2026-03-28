import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_KEY__: string;

// In production server mode, credentials are injected into window
const url =
  typeof __SUPABASE_URL__ !== "undefined"
    ? __SUPABASE_URL__
    : (window as any).__SUPABASE_CONFIG__?.url;

const key =
  typeof __SUPABASE_KEY__ !== "undefined"
    ? __SUPABASE_KEY__
    : (window as any).__SUPABASE_CONFIG__?.key;

if (!url || !key) {
  throw new Error("Missing Supabase credentials");
}

export const supabase: SupabaseClient = createClient(url, key);
