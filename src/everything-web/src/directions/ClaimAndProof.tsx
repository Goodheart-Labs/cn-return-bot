import { useState } from "react";
import { BROWSERS, PITCH, READING, ZVI_NOTE, ACX_NOTE, type BrowserId, type DemoNote } from "./content";
import { Logo } from "./Logo";
import "./claimAndProof.css";

/* Direction: claim and proof. A neutral grey scale with one blue, and every
 * sentence the page says about Common Notes is followed at once by the piece
 * of interface that proves it. */

function Note({ note, voted }: { note: DemoNote; voted?: "helpful" }) {
  return (
    <div className="cp-note">
      <p className="cp-note-status">Rated helpful</p>
      <p className="cp-note-text">{note.note}</p>
      <p className="cp-note-sources">
        {note.sources.map((s) => (
          <a key={s.url} href={s.url}>
            {s.label}
          </a>
        ))}
      </p>
      <div className="cp-pills" role="group" aria-label="Rate this note">
        <button type="button" aria-pressed={voted === "helpful"}>
          Helpful
        </button>
        <button type="button" aria-pressed={false}>
          Somewhat
        </button>
        <button type="button" aria-pressed={false}>
          Not helpful
        </button>
      </div>
    </div>
  );
}

function PageProof() {
  const n = ZVI_NOTE;
  return (
    <div className="cp-frame">
      <div className="cp-window">
        <p className="cp-host">thezvi.substack.com</p>
        <p className="cp-post-title">{n.postTitle}</p>
        <p className="cp-para">
          {n.before}
          <mark>{n.quote}</mark>
        </p>
        <Note note={n} />
      </div>
    </div>
  );
}

function VideoProof() {
  return (
    <div className="cp-frame">
      <div className="cp-player">
        <div className="cp-player-card">
          <p className="cp-note-status">Common Note at 14:32</p>
          <p>The speaker's figure is from 2015. The latest WHO and UNICEF data put it at 11% in 2022.</p>
        </div>
        <div className="cp-player-bar">
          <span className="cp-player-progress" />
        </div>
      </div>
      <p className="cp-caption">Example. The card appears while the claim plays and folds away after.</p>
    </div>
  );
}

function RateProof() {
  return (
    <div className="cp-frame">
      <Note note={ACX_NOTE} voted="helpful" />
    </div>
  );
}

function CharityProof() {
  const [charity, setCharity] = useState("GiveDirectly");
  return (
    <div className="cp-frame">
      <div className="cp-donation">
        <p className="cp-donation-line">
          Your Helpful vote pledges <strong>$3.08</strong> to {charity} if this note ends up rated helpful.
        </p>
        <div className="cp-segments" role="radiogroup" aria-label="Charity">
          {["GiveDirectly", "GiveWell", "Animal Charity Evaluators", "EA Long-Term Future Fund"].map((c) => (
            <button key={c} type="button" role="radio" aria-checked={charity === c} onClick={() => setCharity(c)}>
              {c}
            </button>
          ))}
        </div>
        <p className="cp-caption">Common Notes pays. The amount shrinks as a note's rating becomes clear.</p>
      </div>
    </div>
  );
}

function RequestProof() {
  return (
    <div className="cp-frame">
      <div className="cp-status-card">
        <p className="cp-status-title">We haven't checked this post yet</p>
        <div className="cp-status-actions">
          <button type="button" className="cp-button cp-button-solid">
            Request Common Notes
          </button>
          <button type="button" className="cp-button">
            Check this author's new posts
          </button>
        </div>
      </div>
    </div>
  );
}

const PAIRS = [
  {
    title: "Notes sit inside the page.",
    text: "On an article the sentence is tinted and the note opens beside it. On a video a card appears over the player while the claim plays.",
    proof: <VideoProof />,
  },
  {
    title: "AI writes. People rate.",
    text: "The pipeline writes notes at a scale no volunteer community could. Readers decide which notes help, with one click and no account.",
    proof: <RateProof />,
  },
  {
    title: "Every rating funds a charity.",
    text: "Each vote pledges a donation from Common Notes to a charity you pick. The rule pays for honest ratings, not for agreeing with the crowd.",
    proof: <CharityProof />,
  },
  {
    title: "It follows what you read.",
    text: "The pipeline checks the creators our readers actually visit. Any page you ask about gets checked first.",
    proof: <RequestProof />,
  },
];

function Install() {
  const [browser, setBrowser] = useState<BrowserId>("chrome");
  const b = BROWSERS.find((x) => x.id === browser)!;
  return (
    <section className="cp-install" id="download" aria-labelledby="cp-install-title">
      <h2 id="cp-install-title" className="cp-h2">
        Install the extension.
      </h2>
      <div className="cp-segments cp-segments-large" role="tablist" aria-label="Browser">
        {BROWSERS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={browser === x.id} onClick={() => setBrowser(x.id)}>
            {x.name}
            {!x.href && <span className="cp-soon">Soon</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="cp-install-panel">
        <p>{b.how}</p>
        {b.href ? (
          <a className="cp-button cp-button-solid cp-button-large" href={b.href}>
            Add to {b.name}
          </a>
        ) : (
          <span className="cp-button cp-button-large" aria-disabled="true">
            Coming soon
          </span>
        )}
      </div>
    </section>
  );
}

export function ClaimAndProof() {
  return (
    <div className="cp-root">
      <header className="cp-top">
        <a className="cp-brand" href="#home">
          <Logo size={24} />
          Common Notes
        </a>
        <nav aria-label="Main">
          <a href="#home" aria-current="page">
            Home
          </a>
          <a href="#notes">Notes</a>
          <a href="#download">Download</a>
        </nav>
        <div className="cp-top-actions">
          <a href="#signin" className="cp-button">
            Sign in
          </a>
          <a href={BROWSERS[0]!.href} className="cp-button cp-button-solid">
            Add to Chrome
          </a>
        </div>
      </header>

      <main>
        <section className="cp-hero">
          <div>
            <h1 className="cp-h1">Towards a more truthful internet.</h1>
            <p className="cp-lede">{PITCH}</p>
            <div className="cp-hero-actions">
              <a className="cp-button cp-button-solid cp-button-large" href={BROWSERS[0]!.href}>
                Add to Chrome, free
              </a>
              <a className="cp-button cp-button-large" href="#notes">
                Read the notes
              </a>
            </div>
            <p className="cp-caption">Also for Firefox and Edge. Safari is coming.</p>
          </div>
          <PageProof />
        </section>

        {PAIRS.map((pair) => (
          <section key={pair.title} className="cp-pair">
            <div>
              <h2 className="cp-h2">{pair.title}</h2>
              <p className="cp-pair-text">{pair.text}</p>
            </div>
            {pair.proof}
          </section>
        ))}

        <section className="cp-pair cp-reading" aria-labelledby="cp-reading-title">
          <h2 id="cp-reading-title" className="cp-h2">
            Why community notes, and why everywhere.
          </h2>
          <div className="cp-reading-links">
            {READING.map((r) => (
              <a key={r.href} href={r.href} className="cp-reading-link">
                <span>{r.title}</span>
                <small>
                  {r.kind} · {r.source} · link to come
                </small>
              </a>
            ))}
          </div>
        </section>

        <Install />
      </main>

      <footer className="cp-footer">
        <span>
          An alpha project by <a href="https://goodheartlabs.com">Goodheart Labs</a>. Not affiliated with X.
        </span>
        <nav aria-label="Legal">
          <a href="#impressum">Impressum</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </div>
  );
}
