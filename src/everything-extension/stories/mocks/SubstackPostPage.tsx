import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InlineNotesApp, type AnchoredGroup } from "../../components/InlineNotes";
import { anchorGroups } from "../../utils/anchorGroups";
import { claimGroups, itemNoteSetQuery } from "../../utils/claimGroups";
import { applyHighlights, ensureHighlightStyle } from "../../utils/passageHighlights";
import type { PageItem } from "@cn/core/items";

/* A fictional Substack post with the extension running on it. The page is a
 * mock that copies the shape of a Substack article, and the notes are the
 * fixtures. What runs on it is the extension's own code: the anchoring that
 * finds each quote in the text, the passage tint, and the overlay with its
 * markers and note cards. Click a marker or a tinted passage to open a note.
 *
 * A mock cannot notice when Substack changes its real pages. Whether the
 * extension still works there is checked with the preview script in
 * src/everything-extension/scripts. */

/** Substack's interface font, so the page stays the same whichever design
 *  our notes wear. */
const HOST_UI_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const SHOW_EVERY_NOTE = { showNeedsRatings: true, showUnhelpful: true };

type NoteStyle = "margin" | "classic";

function Overlay({ article, layer, noteStyle, item }: { article: HTMLElement; layer: HTMLElement; noteStyle: NoteStyle; item: PageItem }) {
  const noteSet = useQuery(itemNoteSetQuery(item.id)).data;
  const [anchored] = useState<AnchoredGroup[]>(() => {
    if (!noteSet) return [];
    const groups = anchorGroups(article, claimGroups(noteSet, SHOW_EVERY_NOTE));
    ensureHighlightStyle(document.documentElement.classList.contains("dark"));
    applyHighlights(groups.map((g) => g.range));
    return groups;
  });
  return <InlineNotesApp groups={anchored} item={item} container={article} inlineContainer={layer} noteStyle={noteStyle} />;
}

/** The post. `item` is the page's item, whose notes the query cache must
 *  hold, and `chartImage` the picture in the middle of the post. */
export function SubstackPostPage({ noteStyle, item, chartImage }: { noteStyle: NoteStyle; item: PageItem; chartImage: string }) {
  const [article, setArticle] = useState<HTMLElement | null>(null);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  return (
    <div className="min-h-screen bg-white text-black">
      <header className="flex items-center justify-between px-6 py-3" style={{ borderBottom: "1px solid #e6e6e6", fontFamily: HOST_UI_FONT }}>
        <span className="text-lg font-bold">The Weekly Ledger</span>
        <span className="text-sm" style={{ color: "#6b6b6b" }}>Subscribe</span>
      </header>
      <article ref={setArticle} className="mx-auto max-w-[728px] px-6 py-10" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
        <h1 className="text-2xl font-bold" style={{ fontSize: "2.25rem", lineHeight: 1.2 }}>The housing numbers nobody reads</h1>
        <p className="mt-2 text-lg" style={{ color: "#6b6b6b" }}>Why the market is not as stuck as everyone says</p>
        <p className="mt-4 text-sm" style={{ color: "#6b6b6b", fontFamily: HOST_UI_FONT }}>Alex Rivera · 2 days ago</p>
        <div className="available-content mt-8 space-y-5 text-lg leading-relaxed">
          <p>
            Every few months a new report tells us that housing is broken. Prices are too high, nobody builds, and nothing
            ever changes. I read these reports so you do not have to, and this time I went looking for the numbers behind
            them.
          </p>
          <p>
            Everyone says the housing market is stuck, but the numbers tell a different story. Rents in the city fell by 20%
            last year. That is the largest drop since records began, and it happened while the population grew.
          </p>
          <p>Building has picked up too. Look at how permits moved over the year:</p>
          <img src={chartImage} alt="Permits per quarter" style={{ borderRadius: 8, border: "1px solid #e6e6e6" }} />
          <p>
            None of this means the problem is solved. It means the story we keep telling about it is out of date, and that
            the next report deserves the same skepticism as the last one.
          </p>
        </div>
        {/* In the extension this layer is a shadow root, which also resets the
            host page's font. The classes stand in for that reset. */}
        <div ref={setLayer} className="relative h-0 w-0 font-sans text-base text-fg" />
      </article>
      {article && layer && <Overlay article={article} layer={layer} noteStyle={noteStyle} item={item} />}
    </div>
  );
}

