/**
 * Local scripts remap SUPABASE_URL/SUPABASE_SERVICE_KEY to their LOCAL_*
 * equivalents so the pipeline writes to local Supabase. The dashboard still
 * lives on prod though, so the auto-open flow needs the original prod values.
 *
 * Capture the prod creds once (before any remap), then expose them via a
 * getter so consumers can't accidentally read post-remap values.
 */

interface ProdCreds {
  url: string | undefined;
  serviceKey: string | undefined;
}

let captured: ProdCreds | null = null;

export function captureProdSupabaseCreds(): void {
  if (captured) return;
  captured = {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
  };
}

export function getProdSupabaseCreds(): ProdCreds {
  if (!captured) {
    throw new Error("captureProdSupabaseCreds() must be called before the local Supabase remap");
  }
  return captured;
}
