import { useState } from "react";
import { BROWSERS, NOTES_PER_WEEK, PIPELINE_30_DAYS, PITCH, READING, ZVI_NOTE, ACX_NOTE, type BrowserId, type DemoNote } from "./content";
import { Logo } from "./Logo";
import "./sourcedFigures.css";

/* Direction: sourced figures. Every block on the page is a figure the way a
 * data publication sets one: a title that states the finding, a subtitle, the
 * figure, and a source line. It is how Common Notes treats every claim. */

const fmt = (n: number) => n.toLocaleString("en-US");

function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; badge?: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="sf-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" aria-selected={value === t.id} className="sf-tab" onClick={() => onChange(t.id)}>
          {t.label}
          {t.badge && <span className="sf-tab-badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/** The votes a note has, one cell per vote, plus dashed cells for the votes
 *  it still needs before its rating settles. */
function VoteCells({ votes, missing = 0 }: { votes: DemoNote["votes"]; missing?: number }) {
  const cells = [
    ...Array<string>(votes.helpful).fill("helpful"),
    ...Array<string>(votes.somewhat).fill("somewhat"),
    ...Array<string>(votes.notHelpful).fill("not-helpful"),
    ...Array<string>(missing).fill("ghost"),
  ];
  return (
    <span className="sf-cells" aria-hidden="true">
      {cells.map((kind, i) => (
        <span key={i} className={`sf-cell sf-cell-${kind}`} />
      ))}
    </span>
  );
}

function NoteCard({ note, settled = true }: { note: DemoNote; settled?: boolean }) {
  return (
    <article className={`sf-note ${settled ? "" : "sf-note-pending"}`}>
      <header className="sf-note-head">
        <span className="sf-note-status">{settled ? "Rated helpful" : "Needs more ratings"}</span>
        <VoteCells votes={note.votes} />
      </header>
      <p className="sf-note-text">{note.note}</p>
      <p className="sf-note-sources">
        Sources:{" "}
        {note.sources.map((s, i) => (
          <span key={s.url}>
            {i > 0 && ", "}
            <a href={s.url}>{s.label}</a>
          </span>
        ))}
      </p>
      <div className="sf-note-rate" role="group" aria-label="Rate this note">
        <button type="button">Helpful</button>
        <button type="button">Somewhat</button>
        <button type="button">Not helpful</button>
      </div>
      <p className="sf-ticket">
        On <cite>{note.postTitle}</cite>, {note.creator}, {note.published}
      </p>
    </article>
  );
}

/** Figure 1: the post as the extension draws it, the note beside the claim. */
function InPageFigure() {
  const [view, setView] = useState<"page" | "note" | "sources">("page");
  const n = ZVI_NOTE;
  return (
    <figure className="sf-figure sf-figure-hero">
      <figcaption>
        <h2 className="sf-fig-title">A note appears next to the claim it is about</h2>
        <p className="sf-fig-sub">A post by {n.creator}, as a reader with the extension saw it.</p>
      </figcaption>
      <Tabs
        label="Figure view"
        value={view}
        onChange={setView}
        tabs={[{ id: "page", label: "On the page" }, { id: "note", label: "Note" }, { id: "sources", label: "Sources" }]}
      />
      <div className="sf-fig-body">
        {view === "page" && (
          <div className="sf-page">
            <p className="sf-page-host">thezvi.substack.com</p>
            <h3 className="sf-page-title">{n.postTitle}</h3>
            <span className="sf-page-line" />
            <span className="sf-page-line sf-short" />
            <p className="sf-page-para">
              {n.before}
              <mark>{n.quote}</mark>
              {n.after}
            </p>
            <div className="sf-page-note">
              <NoteCard note={n} />
            </div>
            <span className="sf-page-line" />
            <span className="sf-page-line sf-short" />
          </div>
        )}
        {view === "note" && <NoteCard note={n} />}
        {view === "sources" && (
          <ol className="sf-source-list">
            {n.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url}>{s.url}</a>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="sf-source">
        <strong>Source:</strong> <a href={n.postUrl}>{n.postTitle}</a>, {n.published}. Note written by the Common Notes pipeline and rated
        helpful by all {n.votes.helpful} readers who rated it. The page is redrawn; the other lines of the post are left out.
      </p>
    </figure>
  );
}

/** Figure 2: how many claims the pipeline pulled out, checked and noted. */
function PipelineFigure() {
  const [view, setView] = useState<"chart" | "table">("chart");
  const p = PIPELINE_30_DAYS;
  const rows = [
    { label: "Claims pulled out of the posts", value: p.claimsExtracted },
    { label: "Checked against sources", value: p.claimsChecked },
    { label: "Got a note", value: p.notes },
  ];
  return (
    <figure className="sf-figure">
      <figcaption>
        <h2 className="sf-fig-title">Four in five claims look sound at first reading. Of the rest, about one in twelve gets a note.</h2>
        <p className="sf-fig-sub">
          Claims in {fmt(p.posts)} posts and videos from the creators our readers follow, {p.period}.
        </p>
      </figcaption>
      <Tabs label="Figure view" value={view} onChange={setView} tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
      <div className="sf-fig-body">
        {view === "chart" ? (
          <div className="sf-bars">
            {rows.map((r) => (
              <div key={r.label} className="sf-bar-row">
                <span className="sf-bar-label">{r.label}</span>
                <span className="sf-bar-track">
                  <span className="sf-bar" style={{ width: `${Math.max((r.value / p.claimsExtracted) * 100, 0.6)}%` }} />
                  <span className="sf-bar-value">{fmt(r.value)}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <table className="sf-table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{fmt(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="sf-source">
        <strong>Source:</strong> Common Notes database. A claim is checked only when a first reading rates it uncertain or likely false.
      </p>
    </figure>
  );
}

/** Figure 3: readers settle a note's rating. */
function RatingFigure() {
  return (
    <figure className="sf-figure">
      <figcaption>
        <h2 className="sf-fig-title">Readers decide which notes count</h2>
        <p className="sf-fig-sub">
          Anyone can rate a note, no account needed. Three helpful votes and no other votes settle a note as helpful. Every rating pledges
          a donation from Common Notes to a charity the rater picks.
        </p>
      </figcaption>
      <div className="sf-fig-body sf-rating-grid">
        <div>
          <p className="sf-rating-caption">
            <VoteCells votes={ACX_NOTE.votes} /> Settled: {ACX_NOTE.votes.helpful} helpful votes
          </p>
          <NoteCard note={ACX_NOTE} />
        </div>
        <div className="sf-rating-legend">
          <p>
            <VoteCells votes={{ helpful: 1, somewhat: 0, notHelpful: 0 }} missing={2} /> Needs more ratings. The dashed cells are the votes
            still missing.
          </p>
          <p>
            <VoteCells votes={{ helpful: 3, somewhat: 0, notHelpful: 0 }} /> Rated helpful. The note is shown first.
          </p>
          <p>
            <VoteCells votes={{ helpful: 0, somewhat: 0, notHelpful: 2 }} /> Rated not helpful. The note sinks to the bottom.
          </p>
        </div>
      </div>
      <p className="sf-source">
        <strong>Source:</strong> Common Notes rating rule. The note shown is real; the cell rows beside it are examples.
      </p>
    </figure>
  );
}

/** Figure 4: notes written per week. */
function GrowthFigure() {
  const max = Math.max(...NOTES_PER_WEEK.map((w) => w.notes));
  return (
    <figure className="sf-figure">
      <figcaption>
        <h2 className="sf-fig-title">The pipeline now writes about 400 notes a week</h2>
        <p className="sf-fig-sub">Notes written per week, July to September 2026.</p>
      </figcaption>
      <div className="sf-fig-body">
        <div className="sf-columns" role="img" aria-label="Notes per week rose from about 20 in July to about 430 in late September.">
          {NOTES_PER_WEEK.map((w) => (
            <div key={w.week} className="sf-column">
              <span className="sf-column-value">{w.notes}</span>
              <span className="sf-column-bar" style={{ height: `${(w.notes / max) * 100}%` }} />
              <span className="sf-column-label">{w.week}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="sf-source">
        <strong>Source:</strong> Common Notes database, weeks starting on the date shown. The pipeline was paused in the week of 27 July.
      </p>
    </figure>
  );
}

function Install() {
  const [browser, setBrowser] = useState<BrowserId>("chrome");
  const b = BROWSERS.find((x) => x.id === browser)!;
  return (
    <section className="sf-install" id="download" aria-labelledby="sf-install-title">
      <h2 id="sf-install-title" className="sf-h2">
        Install the extension
      </h2>
      <Tabs
        label="Browser"
        value={browser}
        onChange={setBrowser}
        tabs={BROWSERS.map((x) => ({ id: x.id, label: x.name, badge: x.href ? undefined : "Coming soon" }))}
      />
      <div className="sf-install-panel" role="tabpanel">
        <p className="sf-install-name">Common Notes for {b.name}</p>
        <p className="sf-install-how">{b.how}</p>
        {b.href ? (
          <a className="sf-button" href={b.href}>
            Add to {b.name}
          </a>
        ) : (
          <span className="sf-button sf-button-disabled" aria-disabled="true">
            Not available yet
          </span>
        )}
      </div>
    </section>
  );
}

export function SourcedFigures() {
  return (
    <div className="sf-root">
      <header className="sf-top">
        <a className="sf-brand" href="#home">
          <Logo size={26} />
          Common Notes
        </a>
        <nav className="sf-nav" aria-label="Main">
          <a href="#home" aria-current="page">
            Home
          </a>
          <a href="#notes">Notes</a>
          <a href="#download">Download</a>
        </nav>
        <a className="sf-signin" href="#signin">
          Sign in
        </a>
      </header>

      <main>
        <section className="sf-hero">
          <div className="sf-hero-copy">
            <h1 className="sf-h1">Towards a more truthful internet</h1>
            <p className="sf-lede">{PITCH}</p>
            <a className="sf-button sf-button-large" href={BROWSERS[0]!.href}>
              Add to Chrome, it is free
            </a>
            <p className="sf-hero-also">
              Also for <a href="#download">Firefox and Edge</a>. Safari is coming.
            </p>
          </div>
          <InPageFigure />
        </section>

        <div className="sf-column-flow">
          <PipelineFigure />
          <RatingFigure />
          <GrowthFigure />

          <section aria-labelledby="sf-reading-title">
            <h2 id="sf-reading-title" className="sf-h2">
              Further reading
            </h2>
            <ul className="sf-reading">
              {READING.map((r) => (
                <li key={r.href}>
                  <a href={r.href}>{r.title}</a>
                  <span>
                    {r.kind}, {r.source}. Link to come.
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <Install />
        </div>
      </main>

      <footer className="sf-footer">
        <p>
          Common Notes is an alpha project by <a href="https://goodheartlabs.com">Goodheart Labs</a>. It is not affiliated with X or its
          Community Notes.
        </p>
        <nav aria-label="Legal">
          <a href="#impressum">Impressum</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </div>
  );
}
