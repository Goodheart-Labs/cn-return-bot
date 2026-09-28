import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { InlineNotesApp, type AnchoredGroup } from "../components/InlineNotes";
import { anchorGroups } from "../utils/anchorGroups";
import { claimGroups, itemNoteSetQuery } from "../utils/claimGroups";
import { applyHighlights, ensureHighlightStyle } from "../utils/passageHighlights";
import { CHART_IMAGE, PAGE_ITEM, PAGE_SEEDS } from "../../everything-storybook/fixtures";

/* A fictional Substack post with the extension running on it. The page is a
 * mock that copies the shape of a Substack article, and the notes are the
 * fixtures. What runs on it is the extension's own code: the anchoring that
 * finds each quote in the text, the passage tint, and the overlay with its
 * markers and note cards. Click a marker or a tinted passage to open a note.
 *
 * A mock cannot notice when Substack changes its real pages. Whether the
 * extension still works there is checked with the preview script in
 * src/everything-extension/scripts. */

const SHOW_EVERY_NOTE = { showNeedsRatings: true, showUnhelpful: true };

function Overlay({ article, layer, noteStyle }: { article: HTMLElement; layer: HTMLElement; noteStyle: "margin" | "classic" }) {
  const noteSet = useQuery(itemNoteSetQuery(PAGE_ITEM.id)).data;
  const [anchored] = useState<AnchoredGroup[]>(() => {
    if (!noteSet) return [];
    const groups = anchorGroups(article, claimGroups(noteSet, SHOW_EVERY_NOTE));
    ensureHighlightStyle(document.documentElement.classList.contains("dark"));
    applyHighlights(groups.map((g) => g.range));
    return groups;
  });
  return <InlineNotesApp groups={anchored} item={PAGE_ITEM} container={article} inlineContainer={layer} noteStyle={noteStyle} />;
}

function SubstackPost({ noteStyle }: { noteStyle: "margin" | "classic" }) {
  const [article, setArticle] = useState<HTMLElement | null>(null);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  return (
    <div className="min-h-screen bg-surface text-fg">
      <header className="flex items-center justify-between border-b border-line px-6 py-3">
        <span className="text-lg font-bold">The Weekly Ledger</span>
        <span className="text-sm text-fg-muted">Subscribe</span>
      </header>
      <article ref={setArticle} className="mx-auto max-w-[728px] px-6 py-10" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
        <h1 className="text-2xl font-bold" style={{ fontSize: "2.25rem", lineHeight: 1.2 }}>The housing numbers nobody reads</h1>
        <p className="mt-2 text-lg text-fg-muted">Why the market is not as stuck as everyone says</p>
        <p className="mt-4 text-sm text-fg-muted" style={{ fontFamily: "var(--cn-font-sans)" }}>Alex Rivera · 2 days ago</p>
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
          <img src={CHART_IMAGE} alt="Permits per quarter" className="rounded-control border border-line" />
          <p>
            None of this means the problem is solved. It means the story we keep telling about it is out of date, and that
            the next report deserves the same skepticism as the last one.
          </p>
        </div>
        {/* In the extension this layer is a shadow root, which also resets the
            host page's font. The classes stand in for that reset. */}
        <div ref={setLayer} className="relative h-0 w-0 font-sans text-base text-fg" />
      </article>
      {article && layer && <Overlay article={article} layer={layer} noteStyle={noteStyle} />}
    </div>
  );
}

const meta = {
  title: "Extension/Substack post",
  component: SubstackPost,
  parameters: { layout: "fullscreen", queries: PAGE_SEEDS },
  globals: { scale: "extension" },
  args: { noteStyle: "margin" },
  argTypes: { noteStyle: { control: "inline-radio", options: ["margin", "classic"] } },
} satisfies Meta<typeof SubstackPost>;
export default meta;

type Story = StoryObj<typeof meta>;

export const MarginNotes: Story = { name: "Notes in the margin" };
export const ClassicBadges: Story = { name: "Badge and popover", args: { noteStyle: "classic" } };
