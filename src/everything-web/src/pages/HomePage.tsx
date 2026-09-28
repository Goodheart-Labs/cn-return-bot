import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { track } from "@cn/core/analytics";
import logoUrl from "@cn/ui/assets/logo.svg";
import { buttonVariants } from "@cn/ui/Button";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import noteOnAPost from "../assets/screenshots/note-on-a-post.webp";
import noteOnAVideo from "../assets/screenshots/note-on-a-video.jpg";
import writeANote from "../assets/screenshots/write-a-note.webp";
import { ScreenshotCarousel, type Screenshot } from "../components/ScreenshotCarousel";
import { BROWSERS, browserById, detectBrowser, type Browser, type BrowserId } from "../lib/extensionStores";

const SCREENSHOTS: Screenshot[] = [
  {
    src: noteOnAPost,
    alt: "A Substack post with one claim highlighted. Below it a note rated helpful corrects the figures and offers Helpful, Somewhat helpful and Not helpful buttons.",
    caption: "A note beside the claim it is about, in a Substack post.",
  },
  {
    src: noteOnAVideo,
    alt: "A YouTube interview with a note card over the video, next to the quoted sentence, waiting for more ratings.",
    caption: "On YouTube, the note appears over the video while the claim plays.",
  },
  {
    src: writeANote,
    alt: "A news article with a sentence selected and a Write a note box open over it.",
    caption: "Select a sentence on any site to write a note of your own.",
  },
];

const READING = [
  {
    title: "Community notes for everything",
    source: "Forethought",
    description: "The idea Common Notes builds on: context that readers find helpful, attached to what they read anywhere online.",
    href: "https://www.forethought.org/research/design-sketches-collective-epistemics",
  },
  {
    title: "How Community Notes reduce viral misinformation",
    source: "TED talk by Keith Coleman and Jay Baxter",
    description: "The team behind Community Notes on X explains how notes that people who usually disagree both rate helpful are found.",
    href: "https://www.ted.com/talks/keith_coleman_and_jay_baxter_how_community_notes_reduce_viral_misinformation",
  },
];

const trackStoreClick = (browser: Browser) => track("extension_store_clicked", { browser: browser.name });
function scrollToInstall() {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  document.getElementById("install")?.scrollIntoView({ behavior, block: "start" });
}

const listOf = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);

/** The main action for the reader's own browser: its store listing, or the
 *  install section for a browser that has no version yet. */
function DownloadButton({ browser, onShowInstall }: { browser: Browser; onShowInstall: () => void }) {
  const className = buttonVariants({ variant: "primary", size: "lg" });
  if (!browser.storeUrl) {
    return (
      <button type="button" className={className} onClick={onShowInstall}>
        Download the extension
      </button>
    );
  }
  return (
    <a href={browser.storeUrl} target="_blank" rel="noopener noreferrer" className={className} onClick={() => trackStoreClick(browser)}>
      Add to {browser.name}, it's free
    </a>
  );
}

function Hero({ browser, onShowInstall }: { browser: Browser; onShowInstall: () => void }) {
  const others = BROWSERS.filter((b) => b.storeUrl && b.id !== browser.id).map((b) => b.name);
  return (
    <section className="grid items-center gap-10 py-12 md:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-14">
      <div>
        <h1 className="font-display text-display font-extrabold tracking-tight text-fg text-balance">Towards a more truthful internet</h1>
        <p className="mt-5 max-w-[36ch] text-lg text-fg-secondary">
          Community notes on the posts and videos you read, shown right next to the claim they are about.
        </p>
        <div className="mt-8">
          <DownloadButton browser={browser} onShowInstall={onShowInstall} />
        </div>
        <p className="mt-3 text-sm text-fg-muted">
          Also for {listOf(others)}.{" "}
          <button type="button" className={buttonVariants({ variant: "link" })} onClick={onShowInstall}>
            All browsers
          </button>
        </p>
      </div>
      <ScreenshotCarousel screenshots={SCREENSHOTS} />
    </section>
  );
}

function Pitch() {
  return (
    <section className="border-t border-line py-12 md:py-16">
      <p className="max-w-[65ch] text-xl text-fg">
        Our claim-checking pipeline writes notes on the Substack articles and YouTube videos our readers visit, and the extension shows each note
        right on the page. Readers rate the notes. A note that a diverse set of readers rates helpful is shown more prominently.
      </p>
    </section>
  );
}

function FurtherReading() {
  return (
    <section aria-labelledby="reading-title" className="pb-12 md:pb-16">
      <h2 id="reading-title" className="font-display text-2xl font-bold text-fg">
        Why notes, and why everywhere
      </h2>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {READING.map((r) => (
          <a
            key={r.href}
            href={r.href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(cardVariants(), "group block p-6 transition-colors hover:border-line-strong")}
          >
            <span className="text-sm text-fg-muted">{r.source}</span>
            <span className="mt-1 block text-lg font-semibold text-fg group-hover:text-link">{r.title}</span>
            <span className="mt-2 block text-base text-fg-secondary">{r.description}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

/** The install section: one tab per browser, opened on the reader's own. */
function Install({ initial }: { initial: BrowserId }) {
  const [selected, setSelected] = useState<BrowserId>(initial);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const browser = browserById(selected);

  // Left and right arrows move between the tabs, as in any tab list.
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = (index + step + BROWSERS.length) % BROWSERS.length;
    setSelected(BROWSERS[next]!.id);
    tabs.current[next]?.focus();
  };

  return (
    <section id="install" aria-labelledby="install-title" className="scroll-mt-20 border-t border-line py-12 md:py-16">
      <h2 id="install-title" className="font-display text-3xl font-bold text-fg">
        Install the extension
      </h2>
      <div role="tablist" aria-label="Browser" className="mt-6 flex flex-wrap gap-1 border-b border-line">
        {BROWSERS.map((b, i) => (
          <button
            key={b.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`install-tab-${b.id}`}
            aria-selected={b.id === selected}
            aria-controls="install-panel"
            tabIndex={b.id === selected ? 0 : -1}
            onClick={() => setSelected(b.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className="-mb-px flex items-center gap-2 border-b-2 border-transparent px-4 py-2.5 text-base font-medium text-fg-secondary hover:text-fg aria-selected:border-fg aria-selected:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {b.name}
            {!b.storeUrl && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-fg-muted">Coming soon</span>}
          </button>
        ))}
      </div>
      <div id="install-panel" role="tabpanel" aria-labelledby={`install-tab-${selected}`} className="flex flex-col gap-6 pt-8 sm:flex-row sm:items-center">
        <img src={logoUrl} alt="" width={72} height={72} className="shrink-0" />
        <div className="max-w-[60ch]">
          <p className="text-xl font-semibold text-fg">Common Notes for {browser.name}</p>
          <p className="mt-1 text-base text-fg-secondary">{browser.howToInstall}</p>
          <div className="mt-5">
            {browser.storeUrl ? (
              <a
                href={browser.storeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "primary", size: "lg" })}
                onClick={() => trackStoreClick(browser)}
              >
                Download Common Notes for {browser.name}
              </a>
            ) : (
              <button type="button" disabled className={buttonVariants({ variant: "secondary", size: "lg" })}>
                Coming soon
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-line py-10 text-sm text-fg-muted">
      <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
        <div>
          <h2 className="font-semibold text-fg">Impressum</h2>
          <p className="mt-2">
            Common Notes is an alpha project by{" "}
            <a href="https://goodheartlabs.com" className={buttonVariants({ variant: "link" })}>
              Goodheart Labs
            </a>
            . It is not affiliated with X or its Community Notes.
          </p>
        </div>
        <nav aria-label="Legal" className="flex gap-5">
          <a href="privacy/" className="hover:text-fg">
            Privacy
          </a>
          <a href="terms/" className="hover:text-fg">
            Terms
          </a>
        </nav>
      </div>
    </footer>
  );
}

/** The landing page: what Common Notes is, the extension at work, and how to
 *  install it. With `showInstall` set the page opens at the install section,
 *  which is where the header's Download button leads. */
export function HomePage({ showInstall }: { showInstall: boolean }) {
  const [browserId] = useState(detectBrowser);

  useEffect(() => {
    if (showInstall) scrollToInstall();
  }, [showInstall]);

  return (
    <div className="mx-auto max-w-[80rem] px-4 md:px-8">
      <Hero browser={browserById(browserId)} onShowInstall={scrollToInstall} />
      <Pitch />
      <FurtherReading />
      <Install initial={browserId} />
      <SiteFooter />
    </div>
  );
}
