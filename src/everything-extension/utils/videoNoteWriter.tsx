import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { browser } from "#imports";
import type { ContentScriptContext } from "#imports";
import { youtubeWatchUrl } from "@cn/core/pageUrls";
import { queryClient } from "@cn/features/query/queryClient";
import { VideoNoteOverlay } from "../components/VideoNoteOverlay";
import { TAB_CREATOR_MESSAGE_TYPE } from "./authorFeed";
import { showNotesAfterFirstNote } from "./mountWriteAnywhere";
import { createOverlayUi } from "./overlayUi";
import { isPageDark } from "./pageTheme";
import { watchPageTitle, writableVideo } from "./youtubePlayer";

/** Opens the note editor for the playing video at `atSeconds`, or at the
 *  current time when it is left out. */
export type OpenVideoNoteEditor = (atSeconds?: number) => void;

/** Lets a reader write their own note on a stretch of the YouTube video they
 *  are watching. The editor opens from the right-click menu's "Write a Common
 *  Note on this" and from the row the three-dot menu under the video gets.
 *  Nothing is drawn and nothing is sent to our server until the reader opens
 *  the editor, so this runs on every watch page.
 *  Opening the editor pauses the video, and closing it plays the video on if
 *  it was playing before. Once a note is posted, the video counts as covered
 *  on this device, and `onPosted` mounts the video's notes again so the new
 *  note gets its pin. */
export function installVideoNoteWriter(ctx: ContentScriptContext, onPosted: () => void): OpenVideoNoteEditor {
  let editorOpen = false;

  const openEditor: OpenVideoNoteEditor = (atSeconds) => {
    const playing = writableVideo();
    if (editorOpen || !playing || ctx.isInvalid) return;
    editorOpen = true;
    const { videoId, video } = playing;
    const startAt = atSeconds ?? video.currentTime;
    const wasPlaying = !video.paused;
    video.pause();
    const pageUrl = youtubeWatchUrl(videoId);
    // The video's channel decides the project a new item lands in. The
    // question starts while the reader types, and posting waits for it.
    const creatorFeedUrl = browser.runtime.sendMessage({ type: TAB_CREATOR_MESSAGE_TYPE }).then(
      (feedUrl: string | null) => feedUrl,
      () => null,
    );
    const ui = createOverlayUi(ctx, {
      name: "common-notes-ui",
      position: "inline",
      anchor: "body",
      onMount(container) {
        container.classList.add("cn-theme-root");
        container.classList.toggle("dark", isPageDark());
        const root = createRoot(container);
        root.render(
          <QueryClientProvider client={queryClient}>
            <VideoNoteOverlay
              videoId={videoId}
              atSeconds={startAt}
              durationSeconds={video.duration}
              page={{ url: pageUrl, title: watchPageTitle(), creatorFeedUrl }}
              onClose={close}
              onPosted={() => void showNotesAfterFirstNote(pageUrl, onPosted)}
            />
          </QueryClientProvider>,
        );
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    function close() {
      void ui.then((mounted) => mounted.remove());
      editorOpen = false;
      if (wasPlaying) void video.play().catch(() => {});
    }
    void ui.then((mounted) => mounted.mount());
  };

  const listener = (message: unknown) => {
    if ((message as { type?: string })?.type === "cn-write-note") openEditor();
  };
  browser.runtime.onMessage.addListener(listener);
  ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(listener));
  return openEditor;
}
