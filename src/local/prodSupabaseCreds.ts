/**
 * Local scripts overwrite SUPABASE_URL and SUPABASE_SERVICE_KEY with their
 * LOCAL_ equivalents, so that the pipeline writes to the local Supabase. The
 * review dashboard still lives on production though, so the auto-open flow
 * needs the original production values.
 *
 * A script captures the production credentials once, before it does that
 * overwrite. Everything else reads them back through the getter, so nobody can
 * accidentally pick up the local values instead.
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
