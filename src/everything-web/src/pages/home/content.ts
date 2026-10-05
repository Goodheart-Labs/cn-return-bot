import noteOnAPost from "../../assets/screenshots/note-on-a-post.webp";
import noteOnAVideo from "../../assets/screenshots/note-on-a-video.webp";
import requestNotes from "../../assets/screenshots/request-notes.webp";
import writeANote from "../../assets/screenshots/write-a-note.webp";

/* The words and pictures of the homepage. */

export const HEADLINE = "Community Notes 4 Everything";

/** What Common Notes is, in the words of the extension's store listing. */
export const PITCH = [
  "Community Notes are a recent innovation on Twitter/X. They let users and AIs add important context (such as pointing out false statements) to posts. Common Notes is a Community Notes–inspired system that brings this feature to the whole web.",
  "See notes written by others on articles and YouTube videos. We focus on giving a great experience to our initial user base by generating notes for all new releases of blogs and podcasts that our community enjoys.",
  "Our rating system ensures that most notes reaching you have broad support from the user base.",
];

export interface Screenshot {
  src: string;
  /** What the screenshot shows, for screen readers. */
  alt: string;
  /** One line about what the screenshot shows. */
  caption: string;
}

export const SCREENSHOTS: readonly Screenshot[] = [
  {
    src: noteOnAPost,
    alt: "A Substack post with one claim highlighted. Beside it a note rated helpful corrects the figure and asks whether it is helpful, with Yes, Somewhat and No buttons.",
    caption: "A note on Substack",
  },
  {
    src: noteOnAVideo,
    alt: "A YouTube interview with a note card over the video. The note quotes the sentence it is about and is rated helpful.",
    caption: "A note on YouTube",
  },
  {
    src: writeANote,
    alt: "A news article with a sentence selected and a Write a note box open over it.",
    caption: "Write notes on any webpage",
  },
  {
    src: requestNotes,
    alt: "A Substack post we have not checked yet. The extension's toolbar menu offers to request notes on this page and to check the author's new posts.",
    caption: "Request notes on any webpage",
  },
];

/** Scrolls to the install section, without animation for a reader who asked
 *  their system for reduced motion. */
export function scrollToInstall() {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  document.getElementById("install")?.scrollIntoView({ behavior, block: "start" });
}
