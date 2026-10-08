import { runsText } from "@cn/core/readerText";
import { useReader, type ReaderModule } from "../context";

/** A table of contents is only worth showing with at least this many headings. */
const MIN_HEADINGS = 2;

function Contents() {
  const { blocks, features } = useReader();
  const headings = blocks.filter((block) => block.kind === "heading" && block.level <= 3);
  if (!features.has("contents") || headings.length < MIN_HEADINGS) return null;
  const links = headings.map((heading) => (
    <li key={heading.id}><a href={`#${heading.id}`}>{heading.kind === "heading" ? runsText(heading.runs) : ""}</a></li>
  ));
  return <nav className="reader-contents" aria-label="Contents">
    {/* Wide screens show the list as a rail beside the article. Narrow screens
        show the same list behind a disclosure, so the article starts at once. */}
    <details className="reader-contents-narrow"><summary>Contents</summary><ol>{links}</ol></details>
    <div className="reader-contents-wide"><p>Contents</p><ol>{links}</ol></div>
  </nav>;
}

/** The article's section headings as links. */
export const contentsModule: ReaderModule = {
  name: "contents",
  Rail: Contents,
};
