import { useState } from "react";
import { HeartHandshake, MessageSquareText, Users } from "lucide-react";
import { BROWSERS, PITCH, READING, ZVI_NOTE, type BrowserId } from "./content";
import { Logo } from "./Logo";
import "./canon.css";

/* The category standard, played straight: the landing page of a browser
 * extension. A centred promise, one big install button, the product in a
 * browser window, three benefits, questions and answers. */

const BENEFITS = [
  {
    Icon: MessageSquareText,
    title: "Notes right on the page",
    text: "The note appears next to the sentence it is about, or over the video while the claim plays.",
  },
  {
    Icon: Users,
    title: "Written by AI, rated by readers",
    text: "Readers decide which notes help. Rating takes one click and no account.",
  },
  {
    Icon: HeartHandshake,
    title: "Ratings fund charities",
    text: "Every rating pledges a donation from Common Notes to a charity you choose.",
  },
];

const QUESTIONS = [
  { q: "Which sites does it work on?", a: "Substack, YouTube, LessWrong and the Alignment Forum, and any other page that has notes." },
  { q: "Does it read my browsing?", a: "No. The extension decides on your device whether a page has notes. Pages without notes contact no server." },
  { q: "Do I need an account?", a: "No. Reading and rating work without one. Signing in keeps your votes across devices." },
  { q: "Who writes the notes?", a: "An AI pipeline writes them from sources. Readers can also write their own and suggest improvements." },
];

function BrowserWindow() {
  const n = ZVI_NOTE;
  return (
    <div className="ca-window">
      <div className="ca-window-bar">
        <span className="ca-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="ca-url">thezvi.substack.com/p/ai-176-part-1-doing-it-live</span>
      </div>
      <div className="ca-window-page">
        <p className="ca-post-title">{n.postTitle}</p>
        <span className="ca-line" />
        <span className="ca-line ca-line-short" />
        <p className="ca-para">
          {n.before}
          <mark>{n.quote}</mark>
        </p>
        <div className="ca-popover">
          <p className="ca-popover-status">Rated helpful</p>
          <p>{n.note}</p>
          <div className="ca-pills">
            <span>Helpful</span>
            <span>Somewhat</span>
            <span>Not helpful</span>
          </div>
        </div>
        <span className="ca-line" />
      </div>
    </div>
  );
}

function Install() {
  const [browser, setBrowser] = useState<BrowserId>("chrome");
  const b = BROWSERS.find((x) => x.id === browser)!;
  return (
    <section className="ca-install" id="download" aria-labelledby="ca-install-title">
      <h2 id="ca-install-title" className="ca-h2">
        Install the extension
      </h2>
      <div className="ca-tabs" role="tablist" aria-label="Browser">
        {BROWSERS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={browser === x.id} onClick={() => setBrowser(x.id)}>
            {x.name}
            {!x.href && <span className="ca-soon">Coming soon</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="ca-install-panel">
        <p>{b.how}</p>
        {b.href ? (
          <a className="ca-cta" href={b.href}>
            Add Common Notes to {b.name}
          </a>
        ) : (
          <span className="ca-cta ca-cta-off" aria-disabled="true">
            Coming soon
          </span>
        )}
      </div>
    </section>
  );
}

export function Canon() {
  return (
    <div className="ca-root">
      <header className="ca-top">
        <a className="ca-brand" href="#home">
          <Logo size={28} />
          Common Notes
        </a>
        <nav aria-label="Main">
          <a href="#home" aria-current="page">
            Home
          </a>
          <a href="#notes">Notes</a>
          <a href="#download">Download</a>
        </nav>
        <a href="#signin" className="ca-signin">
          Sign in
        </a>
      </header>

      <main>
        <section className="ca-hero">
          <h1 className="ca-h1">Towards a more truthful internet</h1>
          <p className="ca-lede">{PITCH}</p>
          <a className="ca-cta ca-cta-large" href={BROWSERS[0]!.href}>
            Add to Chrome, it's free
          </a>
          <p className="ca-small">Also available for Firefox and Edge. Safari is coming soon.</p>
          <BrowserWindow />
        </section>

        <section className="ca-benefits" aria-label="What Common Notes does">
          {BENEFITS.map(({ Icon, title, text }) => (
            <div key={title} className="ca-benefit">
              <span className="ca-benefit-icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </section>

        <section className="ca-reading" aria-labelledby="ca-reading-title">
          <h2 id="ca-reading-title" className="ca-h2">
            Learn more
          </h2>
          <div className="ca-reading-grid">
            {READING.map((r) => (
              <a key={r.href} href={r.href} className="ca-reading-card">
                <span className="ca-reading-kind">{r.kind}</span>
                <span className="ca-reading-title">{r.title}</span>
                <span className="ca-small">{r.source}. Link to come.</span>
              </a>
            ))}
          </div>
        </section>

        <Install />

        <section className="ca-faq" aria-labelledby="ca-faq-title">
          <h2 id="ca-faq-title" className="ca-h2">
            Questions
          </h2>
          {QUESTIONS.map(({ q, a }) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
      </main>

      <footer className="ca-footer">
        <span>
          © 2026 <a href="https://goodheartlabs.com">Goodheart Labs</a>. Common Notes is not affiliated with X.
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
