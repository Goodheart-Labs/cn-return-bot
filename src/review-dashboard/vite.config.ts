import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { join } from "path";
import { injectSupabaseConfig, resolveSupabaseCredentials } from "./supabaseInjection";

function supabaseCredentialsPlugin(env: Record<string, string>): Plugin {
  const creds = resolveSupabaseCredentials(env, process.argv.includes("--local"));
  return {
    name: "inject-supabase-credentials",
    transformIndexHtml: (html) => injectSupabaseConfig(html, creds),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, join(__dirname, "../.."), "");
  return {
    plugins: [react(), supabaseCredentialsPlugin(env)],
    root: __dirname,
    build: { outDir: "dist" },
  };
});
