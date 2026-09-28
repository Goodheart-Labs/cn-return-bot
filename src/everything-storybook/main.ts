import { fileURLToPath } from "url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";
import tailwindcss from "tailwindcss";
import { CN_ALIASES } from "../cnAliases";

/* Storybook shows every Common Notes component, and whole pages, outside the
 * two apps. Run it with `bun run storybook`.
 *
 * Stories never talk to the real backend. The Supabase address points at a
 * port nothing listens on, so a click on a vote pill fails instead of writing
 * to production, and the data a story shows is seeded into the query cache
 * from fixtures.ts. The extension's browser API is WXT's fake browser, an
 * in-memory stand-in with working storage and messaging. */
const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: [
    "../everything-ui/**/*.stories.tsx",
    "../everything-features/**/*.stories.tsx",
    "../everything-web/src/**/*.stories.tsx",
    "../everything-extension/**/*.stories.tsx",
    "./**/*.stories.tsx",
  ],
  addons: ["@storybook/addon-themes"],
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      resolve: {
        // An array, because Vite takes the first alias that matches, and the
        // two stand-ins must win over the general `@cn/core` prefix.
        alias: [
          { find: "#imports", replacement: here("shims/wxtImports.ts") },
          // The website's realtime channel would keep retrying the dead
          // address and fill the console, so stories get one that does nothing.
          { find: "@cn/core/projectRealtime", replacement: here("shims/projectRealtime.ts") },
          ...Object.entries(CN_ALIASES).map(([find, replacement]) => ({ find, replacement })),
        ],
      },
      define: {
        "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://127.0.0.1:9"),
        "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("storybook-has-no-backend"),
      },
      css: { postcss: { plugins: [tailwindcss({ config: here("tailwind.config.ts") })] } },
    }),
};

export default config;
