import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { withThemeByClassName } from "@storybook/addon-themes";
import type { Decorator, Preview } from "@storybook/react-vite";
import { LoginPromptProvider } from "@cn/features/auth/loginPrompt";
import type { QuerySeed } from "./fixtures";
import "./preview.css";
import "./looks.css";

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

/** Puts the look picked in the toolbar on <html>, where looks.css reads it. */
function Look({ look, children }: { look: string; children: ReactNode }) {
  useEffect(() => {
    if (look === "current") delete document.documentElement.dataset.cnLook;
    else document.documentElement.dataset.cnLook = look;
  }, [look]);
  return children;
}

const withLook: Decorator = (Story, { globals }) => (
  <Look look={globals.look ?? "current"}>
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
      description: "A candidate look for Common Notes, from looks.css",
      toolbar: {
        title: "Look",
        icon: "paintbrush",
        items: [
          { value: "current", title: "Current look" },
          { value: "figures", title: "A. Sourced figures" },
          { value: "margin", title: "B. Margin notes" },
          { value: "proof", title: "C. Claim and proof" },
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
  initialGlobals: { scale: "website", look: "current" },
  parameters: {
    layout: "padded",
    backgrounds: { disable: true },
  },
};

export default preview;
