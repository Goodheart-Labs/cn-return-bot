import { useEffect } from "react";
import logoUrl from "@cn/ui/assets/logo.svg";
import { AuthCorner } from "../../components/AuthCorner";
import { RouteLink } from "../../components/RouteLink";
import type { HeaderProps } from "../../components/SiteHeader";
import { BROWSERS, browserById, detectBrowser } from "../../lib/extensionStores";
import { HOME, INSTALL, NOTES } from "../../lib/routing";
import { HEADLINE, PITCH, READING, SCREENSHOTS, scrollToInstall, trackStoreClick } from "./content";
import { useCarousel } from "./useCarousel";
import { useInstallTabs } from "./useInstallTabs";
import "./preprint.css";

/* Preprint: the homepage is the first page of a paper. Title and byline, the
 * download links under them the way a preprint server lists its formats, the
 * abstract, a figure with three panels, the references, and the install steps
 * as an appendix. */

const PANELS = ["a", "b", "c"];

export function HeaderPreprint({ route, navigate, onSignIn }: HeaderProps) {
  return (
    <header className="pp-header">
      <div className="pp-header-row">
        <RouteLink to={HOME} navigate={navigate} className="pp-brand">
          <img src={logoUrl} alt="" width={22} height={22} />
          Common Notes
        </RouteLink>
        <nav aria-label="Main" className="pp-nav">
          <RouteLink to={HOME} navigate={navigate} current={route.view === "home"} className="pp-nav-link">
            Home
          </RouteLink>
          <RouteLink to={NOTES} navigate={navigate} current={route.view === "notes"} className="pp-nav-link">
            Notes
          </RouteLink>
        </nav>
        <div className="pp-header-actions">
          <AuthCorner onSignIn={onSignIn} />
          <RouteLink to={INSTALL} navigate={navigate} className="pp-download-link">
            Download
          </RouteLink>
        </div>
      </div>
    </header>
  );
}

/** The reader's own browser as a boxed link, then the others, the way a
 *  preprint server lists the formats of a paper. */
function DownloadLinks() {
  const own = browserById(detectBrowser());
  // The browsers that have a version come first, the one still coming last.
  const others = BROWSERS.filter((b) => b.id !== own.id).sort((a, b) => Number(!a.storeUrl) - Number(!b.storeUrl));
  return (
    <p className="pp-downloads">
      {own.storeUrl ? (
        <a href={own.storeUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackStoreClick(own)} className="pp-download pp-download-own">
          Download for {own.name}
        </a>
      ) : (
        <button type="button" onClick={scrollToInstall} className="pp-download pp-download-own">
          Download the extension
        </button>
      )}
      <span className="pp-downloads-also">also</span>
      {others.map((b) =>
        b.storeUrl ? (
          <a key={b.id} href={b.storeUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackStoreClick(b)} className="pp-download">
            {b.name}
          </a>
        ) : (
          <span key={b.id} className="pp-download-soon">
            {b.name} (coming soon)
          </span>
        ),
      )}
    </p>
  );
}

function Figure() {
  const { index, go, held, holdProps } = useCarousel(SCREENSHOTS.length);
  return (
    <figure aria-roledescription="carousel" aria-label="Screenshots of the extension" className="pp-figure" {...holdProps}>
      <div className="pp-figure-frame">
        <div className="pp-figure-track" style={{ transform: `translateX(-${index * 100}%)` }}>
          {SCREENSHOTS.map((s, i) => (
            <img key={s.src} src={s.src} alt={s.alt} width={1280} height={800} aria-hidden={i !== index} className="pp-figure-image" />
          ))}
        </div>
      </div>
      <figcaption className="pp-caption" aria-live={held ? "polite" : "off"}>
        <strong>Figure 1.</strong> The extension at work.{" "}
        {SCREENSHOTS.map((s, i) => (
          <button key={s.src} type="button" aria-current={i === index} onClick={() => go(i)} className="pp-panel">
            ({PANELS[i]}) {s.caption}
          </button>
        ))}
      </figcaption>
    </figure>
  );
}

function Appendix() {
  const { browser, tabListProps, tabProps, panelProps } = useInstallTabs();
  return (
    <section id="install" aria-labelledby="install-title" className="pp-section pp-appendix">
      <h2 id="install-title" className="pp-h2">
        <span className="pp-section-number">A</span>Installing the extension
      </h2>
      <div {...tabListProps} className="pp-tabs">
        {BROWSERS.map((b, i) => (
          <button key={b.id} {...tabProps(i)} className="pp-tab">
            {b.name}
            {!b.storeUrl && <sup>†</sup>}
          </button>
        ))}
      </div>
      <div {...panelProps} className="pp-tab-panel">
        <p>{browser.howToInstall}</p>
        {browser.storeUrl ? (
          <a href={browser.storeUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackStoreClick(browser)} className="pp-download pp-download-own">
            Download Common Notes for {browser.name}
          </a>
        ) : (
          <p className="pp-footnote">† Not available yet.</p>
        )}
      </div>
    </section>
  );
}

export function HomePreprint({ showInstall }: { showInstall: boolean }) {
  useEffect(() => {
    if (showInstall) scrollToInstall();
  }, [showInstall]);

  return (
    <div className="pp-page">
      <article className="pp-paper">
        <header className="pp-title-block">
          <h1 className="pp-h1">{HEADLINE}</h1>
          <p className="pp-byline">
            <a href="https://goodheartlabs.com">Goodheart Labs</a>
            <span className="pp-byline-date">Alpha, September 2026</span>
          </p>
          <DownloadLinks />
        </header>

        <section className="pp-abstract" aria-labelledby="pp-abstract-title">
          <h2 id="pp-abstract-title" className="pp-abstract-title">
            Abstract
          </h2>
          <p>{PITCH}</p>
        </section>

        <Figure />

        <section className="pp-section" aria-labelledby="pp-refs-title">
          <h2 id="pp-refs-title" className="pp-h2">
            References
          </h2>
          <ol className="pp-references">
            {READING.map((r) => (
              <li key={r.href}>
                {r.cite}. <a href={r.href}>{r.title}</a>. {r.description}
              </li>
            ))}
          </ol>
        </section>

        <Appendix />

        <footer className="pp-colophon">
          <p>
            <strong>Impressum.</strong> Common Notes is an alpha project by <a href="https://goodheartlabs.com">Goodheart Labs</a>. It is not
            affiliated with X or its Community Notes.
          </p>
          <p>
            <a href="privacy/">Privacy</a> · <a href="terms/">Terms</a>
          </p>
        </footer>
      </article>
    </div>
  );
}
