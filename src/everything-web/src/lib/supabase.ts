import { createClient } from "@supabase/supabase-js";

// The anon key is public by design — it's baked into this static site. What
// the anon role can actually do is locked down in migration 050: read the
// everything_* tables and cast votes via the cast_everything_vote RPC, nothing else.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (root .env for local dev)");
}

export const supabase = createClient(url, anonKey);
