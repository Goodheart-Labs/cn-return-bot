import { useEffect } from "react";
import logoUrl from "@cn/ui/assets/logo.svg";
import { cn } from "@cn/ui/cn";
import { AuthCorner } from "../../components/AuthCorner";
import { RouteLink } from "../../components/RouteLink";
import type { HeaderProps } from "../../components/SiteHeader";
import { BROWSERS, browserById, detectBrowser } from "../../lib/extensionStores";
import { HOME, INSTALL, NOTES } from "../../lib/routing";
import { HEADLINE, PITCH, READING, SCREENSHOTS, scrollToInstall, trackStoreClick } from "./content";
import { useCarousel } from "./useCarousel";
import { useInstallTabs } from "./useInstallTabs";
import "./stamp.css";

/* Stamp: the page is a document on a desk, and every verdict on it is an
 * inked rubber stamp. The screenshots are exhibits, the install section is a
 * folder with one tab per browser. */

const EXHIBIT_LETTERS = ["A", "B", "C"];

export function HeaderStamp({ route, navigate, onSignIn }: HeaderProps) {
  const nav = "st-nav-link";
  return (
    <header className="st-header">
      <div className="st-header-row">
        <RouteLink to={HOME} navigate={navigate} className="st-brand">
          <img src={logoUrl} alt="" width={26} height={26} />
          Common Notes
        </RouteLink>
        <nav aria-label="Main" className="st-nav">
          <RouteLink to={HOME} navigate={navigate} current={route.view === "home"} className={nav}>
            Home
          </RouteLink>
          <RouteLink to={NOTES} navigate={navigate} current={route.view === "notes"} className={nav}>
            Notes
          </RouteLink>
        </nav>
        <div className="st-header-actions">
          <AuthCorner onSignIn={onSignIn} />
          <RouteLink to={INSTALL} navigate={navigate} className="st-stamp-button st-stamp-button-small st-header-download">
            Download
          </RouteLink>
        </div>
      </div>
    </header>
  );
}

function Exhibits() {
  const { index, go, held, holdProps } = useCarousel(SCREENSHOTS.length);
  const shot = SCREENSHOTS[index]!;
  return (
    <section aria-roledescription="carousel" aria-label="Screenshots of the extension" className="st-exhibits" {...holdProps}>
      <div className="st-exhibit-tabs" role="group" aria-label="Choose a screenshot">
        {SCREENSHOTS.map((s, i) => (
          <button key={s.src} type="button" aria-current={i === index} onClick={() => go(i)} className="st-exhibit-tab">
            Exhibit {EXHIBIT_LETTERS[i]}
          </button>
        ))}
      </div>
      <figure className="st-exhibit">
        <div className="st-exhibit-frame">
          {SCREENSHOTS.map((s, i) => (
            <img
              key={s.src}
              src={s.src}
              alt={s.alt}
              width={1280}
              height={800}
              aria-hidden={i !== index}
              className={cn("st-exhibit-image", i === index && "st-exhibit-image-current")}
            />
          ))}
          <span className="st-stamp st-exhibit-stamp" aria-hidden="true">
            Exhibit {EXHIBIT_LETTERS[index]}
          </span>
        </div>
        <figcaption className="st-exhibit-caption" aria-live={held ? "polite" : "off"}>
          <span>{shot.caption}</span>
          <span className="st-exhibit-source">{shot.source}</span>
        </figcaption>
      </figure>
    </section>
  );
}

function Install() {
  const { browser, tabListProps, tabProps, panelProps } = useInstallTabs();
  return (
    <section id="install" aria-labelledby="install-title" className="st-install">
      <h2 id="install-title" className="st-h2">
        Install the extension
      </h2>
      <div className="st-folder">
        <div {...tabListProps} className="st-folder-tabs">
          {BROWSERS.map((b, i) => (
            <button key={b.id} {...tabProps(i)} className="st-folder-tab">
              {b.name}
              {!b.storeUrl && (
                <span className="st-stamp st-stamp-tiny" aria-label="coming soon">
                  Soon
                </span>
              )}
            </button>
          ))}
        </div>
        <div {...panelProps} className="st-folder-panel">
          <p className="st-folder-title">Common Notes for {browser.name}</p>
          <p className="st-folder-text">{browser.howToInstall}</p>
          {browser.storeUrl ? (
            <a href={browser.storeUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackStoreClick(browser)} className="st-stamp-button">
              <img src={logoUrl} alt="" width={24} height={24} />
              Download Common Notes for {browser.name}
            </a>
          ) : (
            <span className="st-stamp st-stamp-large" role="status">
              Coming soon
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

export function HomeStamp({ showInstall }: { showInstall: boolean }) {
  const browser = browserById(detectBrowser());
  useEffect(() => {
    if (showInstall) scrollToInstall();
  }, [showInstall]);

  return (
    <div className="st-desk">
      <article className="st-sheet">
        <section className="st-hero">
          <h1 className="st-h1">{HEADLINE}</h1>
          <div className="st-hero-action">
            {browser.storeUrl ? (
              <a href={browser.storeUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackStoreClick(browser)} className="st-stamp-button st-stamp-button-large">
                Download for {browser.name}
              </a>
            ) : (
              <button type="button" onClick={scrollToInstall} className="st-stamp-button st-stamp-button-large">
                Download the extension
              </button>
            )}
            <span className="st-stamp st-stamp-free" aria-hidden="true">
              Free
            </span>
          </div>
          <Exhibits />
        </section>

        <section className="st-memo" aria-label="What Common Notes does">
          <dl className="st-memo-head">
            <dt>From</dt>
            <dd>Goodheart Labs</dd>
            <dt>Re</dt>
            <dd>Notes on what you read, rated by readers</dd>
          </dl>
          <p className="st-memo-body">{PITCH}</p>
        </section>

        <section className="st-reading" aria-labelledby="st-reading-title">
          <h2 id="st-reading-title" className="st-h2">
            Background reading
          </h2>
          <div className="st-reading-grid">
            {READING.map((r) => (
              <a key={r.href} href={r.href} target="_blank" rel="noopener noreferrer" className="st-file">
                <span className="st-file-source">{r.source}</span>
                <span className="st-file-title">{r.title}</span>
                <span className="st-file-text">{r.description}</span>
              </a>
            ))}
          </div>
        </section>

        <Install />
      </article>

      <footer className="st-footer">
        <p>
          <strong>Impressum.</strong> Common Notes is an alpha project by <a href="https://goodheartlabs.com">Goodheart Labs</a>. It is not
          affiliated with X or its Community Notes.
        </p>
        <p className="st-footer-links">
          <a href="privacy/">Privacy</a>
          <a href="terms/">Terms</a>
        </p>
      </footer>
    </div>
  );
}
