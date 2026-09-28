import noteOnAPost from "../../assets/screenshots/note-on-a-post.webp";
import noteOnAVideo from "../../assets/screenshots/note-on-a-video.jpg";
import writeANote from "../../assets/screenshots/write-a-note.webp";

/* The words and pictures of the homepage. */

export const HEADLINE = "Towards a more truthful internet";

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
    alt: "A Substack post with one claim highlighted. Below it a note rated helpful corrects the figures and offers Helpful, Somewhat helpful and Not helpful buttons.",
    caption: "A note beside the claim it is about.",
  },
  {
    src: noteOnAVideo,
    alt: "A YouTube interview with a note card over the video, next to the quoted sentence, waiting for more ratings.",
    caption: "A note over the video while the claim plays.",
  },
  {
    src: writeANote,
    alt: "A news article with a sentence selected and a Write a note box open over it.",
    caption: "Select a sentence on any site to write a note of your own.",
  },
];

/** Scrolls to the install section, without animation for a reader who asked
 *  their system for reduced motion. */
export function scrollToInstall() {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  document.getElementById("install")?.scrollIntoView({ behavior, block: "start" });
}
