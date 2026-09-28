import { useState, type ReactNode } from "react";
import { BROWSERS, PIPELINE_30_DAYS, READING, ZVI_NOTE, ACX_NOTE, type BrowserId, type DemoNote } from "./content";
import { Logo } from "./Logo";
import "./sidenotes.css";

/* Direction: scholarly sidenotes. The homepage is a short essay, and its own
 * claims carry notes in the margin, the way the extension puts notes next to
 * a post. Pointing at a marked sentence lights up its note, and the other
 * way round. */

const fmt = (n: number) => n.toLocaleString("en-US");

/** A sentence of the essay and the margin note that belongs to it. */
function Anchored({ id, active, onActive, children }: { id: string; active: string | null; onActive: (id: string | null) => void; children: ReactNode }) {
  return (
    <span
      className={`sn-anchor ${active === id ? "sn-lit" : ""}`}
      onMouseEnter={() => onActive(id)}
      onMouseLeave={() => onActive(null)}
    >
      {children}
    </span>
  );
}

function Margin({ id, active, onActive, children }: { id: string; active: string | null; onActive: (id: string | null) => void; children: ReactNode }) {
  return (
    <aside className={`sn-side ${active === id ? "sn-lit" : ""}`} onMouseEnter={() => onActive(id)} onMouseLeave={() => onActive(null)}>
      {children}
    </aside>
  );
}

function Rate() {
  return (
    <span className="sn-rate" role="group" aria-label="Rate this note">
      <button type="button">Helpful</button>
      <button type="button">Somewhat</button>
      <button type="button">Not helpful</button>
    </span>
  );
}

function NoteBody({ note }: { note: DemoNote }) {
  return (
    <>
      <span className="sn-side-status">Rated helpful by {note.votes.helpful} readers</span>
      <span className="sn-side-text">{note.note}</span>
      <span className="sn-side-sources">
        {note.sources.map((s, i) => (
          <span key={s.url}>
            {i > 0 && " · "}
            <a href={s.url}>{s.label}</a>
          </span>
        ))}
      </span>
      <Rate />
    </>
  );
}

function Install() {
  const [browser, setBrowser] = useState<BrowserId>("chrome");
  const b = BROWSERS.find((x) => x.id === browser)!;
  return (
    <section className="sn-install" id="download" aria-labelledby="sn-install-title">
      <h2 id="sn-install-title" className="sn-h2">
        Install the extension
      </h2>
      <div className="sn-browsers" role="tablist" aria-label="Browser">
        {BROWSERS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={browser === x.id} onClick={() => setBrowser(x.id)}>
            {x.name}
            {!x.href && <small> coming soon</small>}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="sn-install-panel">
        <p>{b.how}</p>
        {b.href ? (
          <a className="sn-button" href={b.href}>
            Add Common Notes to {b.name}
          </a>
        ) : (
          <span className="sn-button sn-button-off" aria-disabled="true">
            Not available yet
          </span>
        )}
      </div>
    </section>
  );
}

export function Sidenotes() {
  const [active, setActive] = useState<string | null>(null);
  const p = PIPELINE_30_DAYS;
  const bind = { active, onActive: setActive };
  return (
    <div className="sn-root">
      <header className="sn-top">
        <a className="sn-brand" href="#home">
          <Logo size={24} />
          Common Notes
        </a>
        <nav aria-label="Main">
          <a href="#home" aria-current="page">
            Home
          </a>
          <a href="#notes">Notes</a>
          <a href="#download">Download</a>
          <a href="#signin">Sign in</a>
        </nav>
      </header>

      <main className="sn-essay">
        <div className="sn-row">
          <div className="sn-main">
            <h1 className="sn-h1">Towards a more truthful internet</h1>
            <p className="sn-lede">
              A browser extension that puts community notes on the posts and videos you already read and watch. An AI writes the notes;
              readers like you decide which ones help.
            </p>
            <p className="sn-cta">
              <a className="sn-button" href={BROWSERS[0]!.href}>
                Add to Chrome, free
              </a>
              <span>
                Also for <a href="#download">Firefox and Edge</a>. Safari is coming.
              </span>
            </p>
          </div>
        </div>

        <div className="sn-row">
          <div className="sn-main">
            <p>
              Here is a note as a reader met it, in the margin of a post by {ZVI_NOTE.creator}.{" "}
              <Anchored id="zvi" {...bind}>
                <q>{ZVI_NOTE.quote}</q>
              </Anchored>{" "}
              The note on the right appeared next to that sentence, on the page itself. Nobody had to go looking for it.
            </p>
          </div>
          <Margin id="zvi" {...bind}>
            <NoteBody note={ZVI_NOTE} />
          </Margin>
        </div>

        <h2 className="sn-h2">How it works</h2>
        <div className="sn-row">
          <div className="sn-main">
            <p>
              Our claim-checking pipeline follows the Substack writers and YouTubers our readers visit.{" "}
              <Anchored id="pipeline" {...bind}>
                In the last thirty days it read {fmt(p.posts)} posts and videos and pulled {fmt(p.claimsExtracted)} factual claims out of
                them.
              </Anchored>{" "}
              It checks the doubtful ones against sources and writes a note where a claim needs context.
            </p>
            <p>
              <Anchored id="rating" {...bind}>
                Notes that a diverse set of readers rate helpful are shown more prominently.
              </Anchored>{" "}
              Rating needs no account and no expertise, and every rating pledges a donation from Common Notes to a charity you pick.
            </p>
          </div>
          <Margin id="pipeline" {...bind}>
            <span className="sn-side-status">From the Common Notes database</span>
            <span className="sn-side-text">
              {p.period}: {fmt(p.claimsExtracted)} claims pulled out, {fmt(p.claimsChecked)} checked against sources, {fmt(p.notes)} notes
              written.
            </span>
          </Margin>
        </div>

        <div className="sn-row">
          <div className="sn-main">
            <p>
              A second example, from {ACX_NOTE.creator}:{" "}
              <Anchored id="acx" {...bind}>
                <q>{ACX_NOTE.quote}</q>
              </Anchored>
            </p>
          </div>
          <Margin id="acx" {...bind}>
            <NoteBody note={ACX_NOTE} />
          </Margin>
        </div>

        <div className="sn-row">
          <div className="sn-main">
            <Install />
            <h2 className="sn-h2">References</h2>
            <ol className="sn-refs">
              {READING.map((r) => (
                <li key={r.href}>
                  <a href={r.href}>{r.title}</a>. {r.source}, {r.kind.toLowerCase()}. Link to come.
                </li>
              ))}
            </ol>
          </div>
        </div>
      </main>

      <footer className="sn-footer">
        <span>
          Common Notes is an alpha project by <a href="https://goodheartlabs.com">Goodheart Labs</a>, not affiliated with X.
        </span>
        <span>
          <a href="#impressum">Impressum</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
        </span>
      </footer>
    </div>
  );
}
