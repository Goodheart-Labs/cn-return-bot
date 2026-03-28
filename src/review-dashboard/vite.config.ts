import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { config } from "dotenv";

const projectRoot = resolve(__dirname, "../..");
config({ path: resolve(projectRoot, ".env") });

const useLocal = process.argv.includes("--local");
const supabaseUrl = useLocal ? process.env.LOCAL_SUPABASE_URL : process.env.SUPABASE_URL;
const supabaseKey = useLocal ? process.env.LOCAL_SUPABASE_SERVICE_KEY : process.env.SUPABASE_SERVICE_KEY;

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: { outDir: "dist" },
  define: {
    __SUPABASE_URL__: JSON.stringify(supabaseUrl),
    __SUPABASE_KEY__: JSON.stringify(supabaseKey),
  },
});
