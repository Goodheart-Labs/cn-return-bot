import { useQuery } from "@tanstack/react-query";
import { fetchItemForUrl } from "@cn/core/items";
import { ALL_FEATURES } from "@cn/core/minisiteFeatures";
import { Reader } from "./reader/Reader";
import "./reader/reader.css";

const ALL = new Set(ALL_FEATURES);

function webAddress(value: string | null): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function Notice({ title, body, url }: { title: string; body?: string; url?: string }) {
  return <div className="reader"><div className="reader-notice" style={{ marginTop: "2.5rem" }}>
    <h1>{title}</h1>
    {body && <p>{body}</p>}
    {url && <a className="reader-original" href={url} target="_blank" rel="noopener noreferrer">Open the original ↗</a>}
  </div></div>;
}

/** One edition: the article at `source` in the reader with every feature on. */
function Edition({ source, scope }: { source: string; scope: string }) {
  const query = useQuery({ queryKey: ["readerItem", source], queryFn: () => fetchItemForUrl(source) });
  if (query.isPending) return <Notice title="Loading the article…" />;
  if (query.isError) return <Notice title="The article couldn’t load." body="Please try again, or read the original." url={source} />;
  const item = query.data;
  if (!item || item.checked_scope === "paragraph") {
    return <Notice title="Common Notes hasn't checked this page yet" body={item ? "Only a selected paragraph was checked. It is not shown here as the full article." : undefined} url={source} />;
  }
  return <Reader item={item} content={item.full_text} scope={scope} features={ALL}
    header={{ title: item.title || new URL(item.url).hostname.replace(/^www\./, ""), publishedAt: item.published_at }} />;
}

/** /read?url=<article>: any article on Common Notes in the reader, with every
 *  feature on. &full=<url> adds a second document below it, which is how the
 *  White House Accord page showed its full text. */
export function ArticleReader({ url, full }: { url: string | null; full: string | null }) {
  const source = webAddress(url);
  const fullSource = webAddress(full);
  if (!source) return <Notice title="Choose an article to read" body="Add a valid article address with ?url= to this page’s address." />;
  return <>
    <Edition key={source} source={source} scope="main" />
    {full !== null && (fullSource
      ? <section aria-label="The full text"><Edition key={fullSource} source={fullSource} scope="full" /></section>
      : <Notice title="The full text address must be an http or https address." />)}
  </>;
}
