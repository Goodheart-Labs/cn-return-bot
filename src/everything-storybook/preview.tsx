import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { withThemeByClassName } from "@storybook/addon-themes";
import type { Decorator, Preview } from "@storybook/react-vite";
import { LoginPromptProvider } from "@cn/features/auth/loginPrompt";
import { DEFAULT_PILL_PALETTE, PillPaletteContext, type PillPalette } from "@cn/features/notes/pillPalette";
import type { QuerySeed } from "./fixtures";
import "./preview.css";

/** A fresh query cache per story, filled from the story's `queries`
 *  parameter. Nothing is ever fetched: the seeded answers never go stale, and
 *  a query that has no seed simply stays empty. */
function StoryQueries({ seeds, children }: { seeds: QuerySeed[]; children: ReactNode }) {
  const [client] = useState(() => {
    const fresh = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    for (const [key, data] of seeds) fresh.setQueryData(key, data);
    return fresh;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const withQueries: Decorator = (Story, { parameters }) => (
  <StoryQueries seeds={parameters.queries ?? []}>
    <LoginPromptProvider value={() => console.info("[storybook] the sign-in form would open here")}>
      <Story />
    </LoginPromptProvider>
  </StoryQueries>
);

/** The website reads at a larger text size than the extension's overlays.
 *  The toolbar switch applies either scale to any story, and each story
 *  starts with the scale of the app it belongs to. */
function ReadingScale({ website, children }: { website: boolean; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.toggle("cn-reading-scale", website);
  }, [website]);
  return children;
}

const withScale: Decorator = (Story, { globals }) => (
  <ReadingScale website={globals.scale !== "extension"}>
    <Story />
  </ReadingScale>
);

/** Shows the rating pills in the palette picked in the toolbar, the way a
 *  reader picks it on the extension's settings page. */
const withPillPalette: Decorator = (Story, { globals }) => (
  <PillPaletteContext.Provider value={(globals.pills as PillPalette | undefined) ?? DEFAULT_PILL_PALETTE}>
    <Story />
  </PillPaletteContext.Provider>
);

const preview: Preview = {
  decorators: [
    withQueries,
    withScale,
    withPillPalette,
    withThemeByClassName({ themes: { light: "", dark: "dark" }, defaultTheme: "light" }),
  ],
  globalTypes: {
    pills: {
      description: "How the rating pills are coloured before anyone votes",
      toolbar: {
        title: "Rating pills",
        icon: "circle",
        items: [
          { value: "colourful", title: "Colourful pills" },
          { value: "neutral", title: "Neutral pills" },
        ],
        dynamicTitle: true,
      },
    },
    scale: {
      description: "Text size of the website or of the extension",
      toolbar: {
        title: "Scale",
        icon: "paragraph",
        items: [
          { value: "website", title: "Website scale" },
          { value: "extension", title: "Extension scale" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { scale: "website", pills: DEFAULT_PILL_PALETTE },
  parameters: {
    layout: "padded",
    backgrounds: { disable: true },
  },
};

export default preview;
