import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vite";
import { CN_ALIASES } from "../../../cnAliases";

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));

/* The claimchecker microsite. It shows saved pipeline runs next to the
 * archived article and never talks to a backend. The shared note card imports
 * the Supabase client, so it gets an address nothing listens on, the same
 * trick Storybook uses. The runs and the article are static files in public/,
 * which the runner scripts write. */
export default defineConfig({
  root: here("."),
  plugins: [react()],
  resolve: { alias: Object.entries(CN_ALIASES).map(([find, replacement]) => ({ find, replacement })) },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://127.0.0.1:9"),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("the-lab-has-no-backend"),
  },
  css: { postcss: { plugins: [tailwindcss({ config: here("tailwind.config.ts") })] } },
});
