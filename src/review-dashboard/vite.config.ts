import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { config } from "dotenv";

const projectRoot = resolve(__dirname, "../..");
config({ path: resolve(projectRoot, ".env") });

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: { outDir: "dist" },
  define: {
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL),
    __SUPABASE_KEY__: JSON.stringify(process.env.SUPABASE_SERVICE_KEY),
  },
});
