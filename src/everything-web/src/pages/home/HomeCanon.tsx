import { useEffect } from "react";
import logoUrl from "@cn/ui/assets/logo.svg";
import { buttonVariants } from "@cn/ui/Button";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { NextIcon, PreviousIcon } from "@cn/ui/icons";
import { BROWSERS, browserById, detectBrowser } from "../../lib/extensionStores";
import { HEADLINE, PITCH, READING, SCREENSHOTS, scrollToInstall, trackStoreClick } from "./content";
import { useCarousel } from "./useCarousel";
import { useInstallTabs } from "./useInstallTabs";

/* The sketch played straight: one centered column in the sketch's order, at
 * the finish of a well-made extension site. */

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
        <div className="flex gap-2">
          {SCREENSHOTS.map((shot, i) => (
            <button
              key={shot.src}
              type="button"
              aria-label={`Show screenshot ${i + 1}`}
              aria-current={i === index}
              onClick={() => go(i)}
              className="h-2 w-2 rounded-full bg-line-strong transition-[width,background-color] duration-300 aria-[current=true]:w-6 aria-[current=true]:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function Install() {
  const { browser, tabListProps, tabProps, panelProps } = useInstallTabs();
  return (
    <section id="install" aria-labelledby="install-title" className="scroll-mt-20 py-20">
      <h2 id="install-title" className="text-center font-display text-3xl font-bold text-fg">
        Install the extension
      </h2>
      <div className={cn(cardVariants(), "mx-auto mt-8 max-w-2xl overflow-hidden")}>
        <div {...tabListProps} className="grid grid-cols-4 border-b border-line">
          {BROWSERS.map((b, i) => (
            <button
              key={b.id}
              {...tabProps(i)}
              className="relative flex flex-col items-center gap-0.5 px-2 py-3 text-base font-medium text-fg-secondary hover:bg-surface-hover hover:text-fg aria-selected:text-fg aria-selected:after:absolute aria-selected:after:inset-x-0 aria-selected:after:bottom-0 aria-selected:after:h-0.5 aria-selected:after:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus [&+&]:border-l [&+&]:border-line"
            >
              {b.name}
              {!b.storeUrl && <span className="text-xs text-fg-muted">Coming soon</span>}
            </button>
          ))}
        </div>
        <div {...panelProps} className="flex flex-col items-center gap-5 px-6 py-10 text-center">
          <p className="max-w-[44ch] text-base text-fg-secondary">{browser.howToInstall}</p>
          {browser.storeUrl ? (
            <a
              href={browser.storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackStoreClick(browser)}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "gap-3")}
            >
              <img src={logoUrl} alt="" width={24} height={24} className="rounded-[6px] bg-surface" />
              Download Common Notes for {browser.name}
            </a>
          ) : (
            <button type="button" disabled className={buttonVariants({ variant: "secondary", size: "lg" })}>
              Coming soon
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function HomeCanon({ showInstall }: { showInstall: boolean }) {
  const browser = browserById(detectBrowser());
  useEffect(() => {
    if (showInstall) scrollToInstall();
  }, [showInstall]);

  return (
    <div className="px-4 md:px-8">
      <section className="pt-16 text-center md:pt-24">
        <h1 className="mx-auto max-w-4xl font-display text-display font-extrabold tracking-tight text-fg text-balance">{HEADLINE}</h1>
        <div className="mt-8">
          {browser.storeUrl ? (
            <a
              href={browser.storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackStoreClick(browser)}
              className={buttonVariants({ variant: "primary", size: "lg" })}
            >
              Download for {browser.name}, it's free
            </a>
          ) : (
            <button type="button" onClick={scrollToInstall} className={buttonVariants({ variant: "primary", size: "lg" })}>
              Download the extension
            </button>
          )}
        </div>
        <Screenshots />
      </section>

      <section className="mx-auto max-w-3xl pt-20 text-center">
        <p className="text-xl text-fg-secondary text-balance">{PITCH}</p>
        <div className="mt-10 grid gap-4 text-left sm:grid-cols-2">
          {READING.map((r) => (
            <a key={r.href} href={r.href} target="_blank" rel="noopener noreferrer" className={cn(cardVariants(), "group block p-6 transition-colors hover:border-line-strong")}>
              <span className="text-sm text-fg-muted">{r.source}</span>
              <span className="mt-1 block text-lg font-semibold text-fg group-hover:text-link">{r.title}</span>
            </a>
          ))}
        </div>
      </section>

      <Install />

      <footer className="border-t border-line py-10 text-center text-sm text-fg-muted">
        <h2 className="font-semibold text-fg">Impressum</h2>
        <p className="mt-2">
          Common Notes is an alpha project by{" "}
          <a href="https://goodheartlabs.com" className={buttonVariants({ variant: "link" })}>
            Goodheart Labs
          </a>
          . It is not affiliated with X or its Community Notes.
        </p>
        <p className="mt-3 flex justify-center gap-5">
          <a href="privacy/" className="hover:text-fg">
            Privacy
          </a>
          <a href="terms/" className="hover:text-fg">
            Terms
          </a>
        </p>
      </footer>
    </div>
  );
}
