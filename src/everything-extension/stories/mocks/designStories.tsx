import type { StoryObj } from "@storybook/react-vite";
import type { PageItem } from "@cn/core/items";
import { SubstackPostPage } from "./SubstackPostPage";
import { YoutubeWatch } from "./YoutubeWatchPage";

/** How long to wait for the extension's markers to be placed on the mock
 *  post before giving up on opening one. */
const MARKER_WAIT_MS = 3000;
const MARKER_POLL_MS = 100;

/** Waits for an element the extension places once its notes have loaded. */
async function waitFor<T extends Element>(find: () => T | null | undefined): Promise<T | null> {
  for (let waited = 0; waited < MARKER_WAIT_MS; waited += MARKER_POLL_MS) {
    const found = find();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, MARKER_POLL_MS));
  }
  return null;
}

/** Dismisses the one-time "You don't need to be an expert" hint, which would
 *  otherwise cover the note being compared. */
async function dismissVotingHint(canvasElement: HTMLElement) {
  const gotIt = await waitFor(() => [...canvasElement.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Got it"));
  gotIt?.click();
}

/** Opens the first note on the mock Substack post, so the story shows a note
 *  rather than only its marker. */
async function openFirstNote(canvasElement: HTMLElement) {
  const marker = await waitFor(() => canvasElement.querySelector<HTMLButtonElement>('button[title="Community note on this passage"]'));
  marker?.click();
  await dismissVotingHint(canvasElement);
}

/** The extension's surfaces in one candidate design: a Substack post with a
 *  note open, and a YouTube video while a claim plays. The data comes from
 *  the story file, which may read Storybook's fixtures. */
export function extensionDesignStories(
  look: string,
  data: { item: PageItem; chartImage: string; queries: readonly (readonly [readonly unknown[], unknown])[] },
): Record<"SubstackPost" | "YoutubeVideo", StoryObj> {
  const common = { parameters: { layout: "fullscreen", queries: data.queries }, globals: { look, scale: "extension" } };
  return {
    SubstackPost: {
      ...common,
      name: "Substack post",
      render: () => <SubstackPostPage noteStyle="margin" item={data.item} chartImage={data.chartImage} />,
      play: ({ canvasElement }) => openFirstNote(canvasElement),
    },
    YoutubeVideo: {
      ...common,
      name: "YouTube video",
      render: () => <YoutubeWatch seconds={12} item={data.item} />,
      play: ({ canvasElement }) => dismissVotingHint(canvasElement),
    },
  };
}
