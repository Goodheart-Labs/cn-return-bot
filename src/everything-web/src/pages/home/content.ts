import { track } from "@cn/core/analytics";
import noteOnAPost from "../../assets/screenshots/note-on-a-post.webp";
import noteOnAVideo from "../../assets/screenshots/note-on-a-video.jpg";
import writeANote from "../../assets/screenshots/write-a-note.webp";
import type { Browser } from "../../lib/extensionStores";

/* The words and pictures every version of the homepage shows. The versions
 * differ in how they look and how they arrange these, never in what they say. */

export const HEADLINE = "Towards a more truthful internet";

export const PITCH =
  "Our claim-checking pipeline writes notes on the Substack articles and YouTube videos our readers visit, and the extension shows each note right on the page. Readers rate the notes, and a note that a diverse set of readers rates helpful is shown more prominently.";

export interface Screenshot {
  src: string;
  /** What the screenshot shows, for screen readers. */
  alt: string;
  /** One line about what the screenshot shows. */
  caption: string;
  /** Where the screenshot was taken. */
  source: string;
}

export const SCREENSHOTS: readonly Screenshot[] = [
  {
    src: noteOnAPost,
    alt: "A Substack post with one claim highlighted. Below it a note rated helpful corrects the figures and offers Helpful, Somewhat helpful and Not helpful buttons.",
    caption: "A note beside the claim it is about.",
    source: "Substack, Don't Worry About the Vase",
  },
  {
    src: noteOnAVideo,
    alt: "A YouTube interview with a note card over the video, next to the quoted sentence, waiting for more ratings.",
    caption: "A note over the video while the claim plays.",
    source: "YouTube, Dwarkesh Patel",
  },
  {
    src: writeANote,
    alt: "A news article with a sentence selected and a Write a note box open over it.",
    caption: "Select a sentence on any site to write a note of your own.",
    source: "A news site",
  },
];

export interface Reading {
  title: string;
  source: string;
  /** Author and year, for a reference list. */
  cite: string;
  description: string;
  href: string;
}

export const READING: readonly Reading[] = [
  {
    title: "Community notes for everything",
    source: "Forethought",
    cite: "Forethought, 2026",
    description: "The idea Common Notes builds on: context that readers find helpful, attached to what they read anywhere online.",
    href: "https://www.forethought.org/research/design-sketches-collective-epistemics",
  },
  {
    title: "How Community Notes reduce viral misinformation",
    source: "TED talk",
    cite: "Keith Coleman and Jay Baxter, TED 2026",
    description: "The team behind Community Notes on X explains how notes that people who usually disagree both rate helpful are found.",
    href: "https://www.ted.com/talks/keith_coleman_and_jay_baxter_how_community_notes_reduce_viral_misinformation",
  },
];

export const trackStoreClick = (browser: Browser) => track("extension_store_clicked", { browser: browser.name });

/** Scrolls to the install section, without animation for a reader who asked
 *  their system for reduced motion. */
export function scrollToInstall() {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  document.getElementById("install")?.scrollIntoView({ behavior, block: "start" });
}
