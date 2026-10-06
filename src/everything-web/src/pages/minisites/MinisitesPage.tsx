import { useQuery } from "@tanstack/react-query";
import { fetchMinisites, type MinisiteSummary } from "@cn/core/minisites";
import { buttonVariants } from "@cn/ui/Button";
import { RouteLink } from "../../components/RouteLink";
import type { Route } from "../../lib/routing";
import { useIsAdmin } from "../../lib/useIsAdmin";
import "./minisites.css";

const noteCount = (n: number) => `${n} ${n === 1 ? "note" : "notes"}`;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function MinisiteRow({ minisite, navigate }: { minisite: MinisiteSummary; navigate: (route: Route) => void }) {
  const host = new URL(minisite.url).hostname.replace(/^www\./, "");
  const facts = [host, minisite.published_at && formatDate(minisite.published_at), noteCount(minisite.noteCount)].filter(Boolean).join(" · ");
  return <li className={`minisite-row${minisite.image_url ? "" : " minisite-row-plain"}`}>
    {minisite.image_url && <img src={minisite.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    <div>
      <h2>
        {/* The title's link covers the whole row, so the row is one big target. */}
        <RouteLink to={{ view: "minisites", slug: minisite.slug }} navigate={navigate} className="minisite-row-link">{minisite.title}</RouteLink>
      </h2>
      {minisite.description && <p>{minisite.description}</p>}
      <p className="minisite-row-facts">{facts}</p>
    </div>
  </li>;
}

/** Every minisite, newest first, one per row. Admins also get the button that
 *  creates one. */
export function MinisitesPage({ navigate }: { navigate: (route: Route) => void }) {
  const admin = useIsAdmin();
  const minisites = useQuery({ queryKey: ["minisites"], queryFn: fetchMinisites });
  return <main className="minisites-page">
    <div className="minisites-head">
      <div>
        <h1>Minisites</h1>
        <p>Articles with notes, forecasts and key points beside the text. Select any words to add your own or to ask Opus about them.</p>
      </div>
      {admin && <RouteLink to={{ view: "newMinisite" }} navigate={navigate} className={buttonVariants({ variant: "primary" })}>Create a minisite</RouteLink>}
    </div>
    {minisites.isPending ? <p className="minisites-empty" role="status">Loading minisites…</p>
      : minisites.isError ? <p className="minisites-empty" role="alert">The minisites couldn't load. <button type="button" className="minisites-retry" onClick={() => void minisites.refetch()}>Try again</button></p>
      : minisites.data.length === 0 ? <p className="minisites-empty">No minisites yet.</p>
      : <ul className="minisite-rows">{minisites.data.map((minisite) => <MinisiteRow key={minisite.id} minisite={minisite} navigate={navigate} />)}</ul>}
  </main>;
}
