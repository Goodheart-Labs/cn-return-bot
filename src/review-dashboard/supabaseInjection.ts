// Shared by server.ts (prod build) and vite.config.ts (dev HMR) to wire
// Supabase service-role credentials into the dashboard's index.html.
// WARNING: service role key — callers must only serve on localhost.

type Env = Record<string, string | undefined>;

export function resolveSupabaseCredentials(
  env: Env,
  useLocal: boolean,
): { url: string; key: string } {
  const url = useLocal ? env.LOCAL_SUPABASE_URL : env.SUPABASE_URL;
  const key = useLocal ? env.LOCAL_SUPABASE_SERVICE_KEY : env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    const vars = useLocal
      ? "LOCAL_SUPABASE_URL/LOCAL_SUPABASE_SERVICE_KEY"
      : "SUPABASE_URL/SUPABASE_SERVICE_KEY";
    throw new Error(`Missing Supabase credentials in .env (${vars})`);
  }
  return { url, key };
}

export function injectSupabaseConfig(
  html: string,
  creds: { url: string; key: string },
): string {
  const script = `<script>window.__SUPABASE_CONFIG__ = { url: ${JSON.stringify(creds.url)}, key: ${JSON.stringify(creds.key)} };</script>`;
  return html.replace("</head>", `${script}</head>`);
}
