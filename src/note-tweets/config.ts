import "dotenv/config";

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function supabaseConfig() {
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("Missing VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)");
  return {
    url: requiredEnv("SUPABASE_URL"),
    serviceKey: requiredEnv("SUPABASE_SERVICE_KEY"),
    anonKey,
  };
}
