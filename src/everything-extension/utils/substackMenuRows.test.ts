import { afterEach, describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { substackMenuSite } from "./substackMenuRows";

// Trimmed copies of the menus captured on Substack on 2026-11-06 in headless
// Chromium (GOO-747). Each fixture keeps the item boundaries and links the
// rule reads, and drops Substack's styling wrappers. The button is always the
// element with id "more".

const globals = globalThis as unknown as Record<string, unknown>;
const NODE_FILTER = { SHOW_TEXT: 4 };

function loadPage(href: string, body: string) {
  const { document } = parseHTML(`<html><head><title>Open post</title></head><body>${body}</body></html>`);
  globals.document = document;
  globals.location = new URL(href);
  globals.NodeFilter = NODE_FILTER;
  return document.getElementById("more") as unknown as HTMLElement;
}

afterEach(() => {
  delete globals.document;
  delete globals.location;
  delete globals.NodeFilter;
});

const MORE_BUTTON = '<button id="more" aria-haspopup="menu"><svg class="lucide lucide-ellipsis"></svg></button>';

describe("which post a Substack menu is about", () => {
  test("a post in a profile's feed is the one post it links", () => {
    const trigger = loadPage(
      "https://substack.com/@garymarcus",
      `<div role="article"><div data-entity-key="p-223762059">
        <a href="https://substack.com/@garymarcus?utm_source=substack-feed-item">Gary Marcus</a>
        <a href="https://garymarcus.substack.com/p/the-markets-dropped-25-trillion-yesterday">The markets dropped</a>
        <a href="https://garymarcus.substack.com/p/the-markets-dropped-25-trillion-yesterday?utm_source=feed">picture</a>
        ${MORE_BUTTON}</div></div>`,
    );
    const subject = substackMenuSite.subjectFor(trigger);
    expect(subject?.page?.url).toBe("https://garymarcus.substack.com/p/the-markets-dropped-25-trillion-yesterday");
    expect(subject?.page?.current).toBe(false);
  });

  test("a Note in the feed gets no rows, even when it links posts", () => {
    const trigger = loadPage(
      "https://substack.com/home",
      `<div role="article"><div data-entity-key="c-374274726">
        <a href="https://thezvi.substack.com/p/ai-193-progress-may-dramatically">quoted post</a>
        ${MORE_BUTTON}</div></div>`,
    );
    expect(substackMenuSite.subjectFor(trigger)).toBeNull();
  });

  test("a video clip in the feed gets no rows", () => {
    const trigger = loadPage("https://substack.com/home", `<div data-entity-key="m-1">${MORE_BUTTON}</div>`);
    expect(substackMenuSite.subjectFor(trigger)).toBeNull();
  });

  test("a post item that links two different posts gets no rows", () => {
    const trigger = loadPage(
      "https://substack.com/home",
      `<div data-entity-key="p-1">
        <a href="https://a.substack.com/p/first">first</a>
        <a href="https://b.substack.com/p/second">second</a>
        ${MORE_BUTTON}</div>`,
    );
    expect(substackMenuSite.subjectFor(trigger)).toBeNull();
  });

  test("links to a post's comments do not count as other posts", () => {
    const trigger = loadPage(
      "https://substack.com/home",
      `<div data-entity-key="p-1">
        <a href="https://a.substack.com/p/first">first</a>
        <a href="https://a.substack.com/p/first/comment/326281587">a comment</a>
        ${MORE_BUTTON}</div>`,
    );
    expect(substackMenuSite.subjectFor(trigger)?.page?.url).toBe("https://a.substack.com/p/first");
  });

  test("the action bar of an open post is about that post, whatever it links", () => {
    const trigger = loadPage(
      "https://jessesingal.substack.com/p/see-you-this-tuesday",
      `<div class="single-post"><article class="newsletter-post post">
        <div class="post-header" role="region">${MORE_BUTTON}</div>
        <a href="https://jessesingal.substack.com/p/events">events</a>
        <a href="https://ncofnas.com/p/dei-fraud-and-cover-up-at-cambridge">another post</a>
      </article></div>`,
    );
    const subject = substackMenuSite.subjectFor(trigger);
    expect(subject?.page?.url).toBe("https://jessesingal.substack.com/p/see-you-this-tuesday");
    expect(subject?.page?.current).toBe(true);
  });

  test("the header of a post opened as an overlay in the reader is about that post", () => {
    const trigger = loadPage(
      "https://substack.com/home/post/p-223167042",
      `<div class="reader-nav-root"><div class="modalViewer-xO_gxg">
        <div>${MORE_BUTTON}</div>
        <a href="https://jessesingal.substack.com/p/on-the-guardians-weird-possibly-defamatory">the post</a>
        <a href="https://ncofnas.com/p/dei-fraud-and-cover-up-at-cambridge">a link in it</a>
      </div></div>`,
    );
    const subject = substackMenuSite.subjectFor(trigger);
    expect(subject?.page?.url).toBe("https://substack.com/home/post/p-223167042");
    expect(subject?.page?.current).toBe(true);
  });

  test("a comment's menu gets no rows", () => {
    const trigger = loadPage(
      "https://jessesingal.substack.com/p/see-you-this-tuesday",
      `<div class="comment"><div role="article">
        <a href="https://jessesingal.substack.com/p/see-you-this-tuesday/comment/326281587">link</a>
        ${MORE_BUTTON}</div></div>`,
    );
    expect(substackMenuSite.subjectFor(trigger)).toBeNull();
  });

  test("a profile's own menu is about the author only", () => {
    const trigger = loadPage(
      "https://substack.com/@garymarcus",
      `<main class="reader-nav-page"><div>${MORE_BUTTON}</div>
        <a href="https://garymarcus.substack.com/p/the-markets-dropped-25-trillion-yesterday">a post further down</a></main>`,
    );
    const subject = substackMenuSite.subjectFor(trigger);
    expect(subject).not.toBeNull();
    expect(subject?.page).toBeNull();
  });

  test("an inbox row is about its post, without the tracking parameters", () => {
    const trigger = loadPage(
      "https://substack.com/inbox",
      `<div class="reader2-post-container"><a href="https://nothinghuman.substack.com/p/richard-ngo-on-alignment-hierarchical?utm_source=%2Finbox&amp;utm_medium=reader2">post</a>${MORE_BUTTON}</div>`,
    );
    expect(substackMenuSite.subjectFor(trigger)?.page?.url).toBe("https://nothinghuman.substack.com/p/richard-ngo-on-alignment-hierarchical");
  });
});

describe("finding the open menu", () => {
  test("through the button's aria-controls", () => {
    const trigger = loadPage("https://substack.com/home", `<button id="more" aria-controls=":r3n:"></button><div id=":r3n:" role="menu"></div>`);
    expect(substackMenuSite.menuFor(trigger)?.id).toBe(":r3n:");
  });

  test("through the menu's aria-labelledby when the button names no menu", () => {
    const trigger = loadPage("https://substack.com/home", `<button id="more"></button><div id="other" role="menu" aria-labelledby="x more"></div>`);
    expect(substackMenuSite.menuFor(trigger)?.id).toBe("other");
  });

  test("no menu while none is open", () => {
    const trigger = loadPage("https://substack.com/home", `<button id="more"></button><div role="menu" aria-labelledby="someone-else"></div>`);
    expect(substackMenuSite.menuFor(trigger)).toBeNull();
  });
});
