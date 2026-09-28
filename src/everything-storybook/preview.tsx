import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { withThemeByClassName } from "@storybook/addon-themes";
import type { Decorator, Preview } from "@storybook/react-vite";
import { LoginPromptProvider } from "@cn/features/auth/loginPrompt";
import type { QuerySeed } from "./fixtures";
import "./preview.css";
import "@cn/ui/looks/canon.css";
import "@cn/ui/looks/preprint.css";
import "@cn/ui/looks/stamp.css";
import { LookContext, type LookId } from "../everything-web/src/pages/home/variants";

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

/** Puts the design picked in the toolbar on <html>, where the stylesheets in
 *  everything-ui/looks read it, and tells the website which header and
 *  homepage to render. */
function Look({ look, children }: { look: LookId; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.cnLook = look;
  }, [look]);
  return <LookContext.Provider value={look}>{children}</LookContext.Provider>;
}

const withLook: Decorator = (Story, { globals }) => (
  <Look look={(globals.look as LookId | undefined) ?? "canon"}>
    <Story />
  </Look>
);

const preview: Preview = {
  decorators: [
    withQueries,
    withScale,
    withLook,
    withThemeByClassName({ themes: { light: "", dark: "dark" }, defaultTheme: "light" }),
  ],
  globalTypes: {
    look: {
      description: "A candidate design for Common Notes",
      toolbar: {
        title: "Design",
        icon: "paintbrush",
        items: [
          { value: "stamp", title: "A. Stamp" },
          { value: "preprint", title: "B. Preprint" },
          { value: "canon", title: "C. The sketch, straight" },
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
  initialGlobals: { scale: "website", look: "stamp" },
  parameters: {
    options: { storySort: { order: ["Designs", ["A. Stamp", "B. Preprint", "C. The sketch, straight"]] } },
    layout: "padded",
    backgrounds: { disable: true },
  },
};

export default preview;
