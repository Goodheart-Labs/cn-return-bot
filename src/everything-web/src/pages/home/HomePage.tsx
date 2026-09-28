import { useEffect, useState } from "react";
import { buttonVariants } from "@cn/ui/Button";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { NextIcon, PreviousIcon } from "@cn/ui/icons";
import { BrowserLogo, DesktopOnly, StoreButton } from "../../components/StoreButton";
import { BROWSERS, browserById, canInstallExtensions, detectBrowser, isListed } from "../../lib/extensionStores";
import type { Route } from "../../lib/routing";
import { HEADLINE, PITCH, SCREENSHOTS, scrollToInstall } from "./content";
import { useCarousel } from "./useCarousel";
import { useInstallTabs } from "./useInstallTabs";

/* The homepage, laid out as Jim sketched it: one centered column with the
 * headline and the download button, the screenshots, what Common Notes is,
 * and the install section. */

function Screenshots() {
  const { index, go, held, holdProps } = useCarousel(SCREENSHOTS.length);
  return (
    <section aria-roledescription="carousel" aria-label="Screenshots of the extension" className="mx-auto mt-14 w-full max-w-5xl" {...holdProps}>
      <div className="group relative overflow-hidden rounded-card border border-line bg-inverse shadow-floating">
        <div className="flex transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${index * 100}%)` }}>
          {SCREENSHOTS.map((shot, i) => (
            <div key={shot.src} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${SCREENSHOTS.length}`} aria-hidden={i !== index} className="w-full shrink-0">
              <img src={shot.src} alt={shot.alt} width={1280} height={800} className="block aspect-[16/10] w-full object-cover object-top" />
            </div>
          ))}
        </div>
        {[
          { label: "Previous screenshot", step: -1, Icon: PreviousIcon, side: "left-4" },
          { label: "Next screenshot", step: 1, Icon: NextIcon, side: "right-4" },
        ].map(({ label, step, Icon, side }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={() => go(index + step)}
            className={cn(
              "absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-surface text-fg shadow-raised transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100",
              side,
            )}
          >
            <Icon size={20} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-col items-center gap-3">
        <p className="text-sm text-fg-muted" aria-live={held ? "polite" : "off"}>
          {SCREENSHOTS[index]!.caption}
        </p>
        <div className="flex">
          {SCREENSHOTS.map((shot, i) => (
            <button
              key={shot.src}
              type="button"
              aria-label={`Show screenshot ${i + 1}`}
              aria-current={i === index}
              onClick={() => go(i)}
              // The button is a 32 pixel target around the small dot drawn inside it.
              className="group grid h-8 min-w-8 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="h-2 w-2 rounded-full bg-line-strong transition-[width,background-color] duration-300 group-aria-[current=true]:w-6 group-aria-[current=true]:bg-primary" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Install({ navigate, desktop }: { navigate: (route: Route) => void; desktop: boolean }) {
  const { browser, tabListProps, tabProps, panelProps } = useInstallTabs();
  return (
    <section id="install" aria-labelledby="install-title" className="scroll-mt-20 py-20">
      <h2 id="install-title" className="text-center font-title text-3xl font-bold text-fg">
        Install the extension
      </h2>
      <div className={cn(cardVariants(), "mx-auto mt-8 max-w-2xl overflow-hidden")}>
        <div {...tabListProps} className="grid grid-cols-4 border-b border-line">
          {BROWSERS.map((b, i) => (
            <button
              key={b.id}
              {...tabProps(i)}
              className="relative flex flex-col items-center gap-1.5 px-2 py-3 text-base font-medium text-fg-secondary hover:bg-surface-hover hover:text-fg aria-selected:text-fg aria-selected:after:absolute aria-selected:after:inset-x-0 aria-selected:after:bottom-0 aria-selected:after:h-0.5 aria-selected:after:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus [&+&]:border-l [&+&]:border-line"
            >
              <BrowserLogo browser={b} size={28} />
              {b.name}
            </button>
          ))}
        </div>
        <div {...panelProps} className="flex justify-center px-6 py-10 text-center">
          {!desktop ? (
            <DesktopOnly navigate={navigate} />
          ) : isListed(browser) ? (
            <StoreButton browser={browser}>Go to {browser.store.name}</StoreButton>
          ) : (
            <p className="text-base text-fg-secondary">The {browser.name} version is coming soon.</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** The line under the headline that says what Common Notes is. */
const SUBLINE = "Notes beside the claims in Substack posts and YouTube videos. AI writes them, readers rate them.";

export function HomePage({ showInstall, navigate }: { showInstall: boolean; navigate: (route: Route) => void }) {
  const browser = browserById(detectBrowser());
  const [desktop] = useState(canInstallExtensions);
  useEffect(() => {
    if (showInstall) scrollToInstall();
  }, [showInstall]);

  return (
    <div className="bg-surface px-4 md:px-8">
      <section className="pt-16 text-center md:pt-24">
        <h1 className="mx-auto max-w-4xl font-title text-display font-bold tracking-tight text-fg text-balance">{HEADLINE}</h1>
        <p className="mx-auto mt-5 max-w-[52ch] text-lg text-fg-secondary text-balance">{SUBLINE}</p>
        <div className="mt-8">
          {!desktop ? (
            <DesktopOnly navigate={navigate} className="mx-auto max-w-[36ch]" />
          ) : isListed(browser) ? (
            <StoreButton browser={browser}>Download for {browser.name}, it's free</StoreButton>
          ) : (
            <button type="button" onClick={scrollToInstall} className={buttonVariants({ variant: "primary", size: "lg" })}>
              Get the extension
            </button>
          )}
        </div>
        <Screenshots />
      </section>

      <section className="mx-auto max-w-[62ch] space-y-4 pt-20 text-left font-serif text-xl leading-relaxed text-fg-secondary sm:text-center">
        {PITCH.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>

      <Install navigate={navigate} desktop={desktop} />

      {/* The "Impressum" heading returns once its legal details are in. */}
      <footer className="border-t border-line py-10 text-center text-sm text-fg-muted">
        <p>
          Common Notes is an alpha project by{" "}
          <a href="https://goodheartlabs.com" className={buttonVariants({ variant: "link" })}>
            Goodheart Labs
          </a>
          .
        </p>
        <p className="mt-3 flex justify-center gap-5">
          <a href="privacy/" className="underline-offset-4 hover:text-fg hover:underline">
            Privacy
          </a>
          <a href="terms/" className="underline-offset-4 hover:text-fg hover:underline">
            Terms
          </a>
        </p>
      </footer>
    </div>
  );
}
