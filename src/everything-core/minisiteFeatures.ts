/* The reader features a minisite can switch on or off, as a tree. A child only
 * counts while its parent is on. The website, the minisite script and the
 * intake service all read this list, so a feature id means the same thing in
 * all three. Stored lists are kept as they are: an id that is no longer here is
 * ignored, and a feature added here later starts off on existing minisites. */

export interface FeatureNode {
  id: string;
  label: string;
  description: string;
  children?: readonly FeatureNode[];
}

export const FEATURE_TREE = [
  {
    id: "notes",
    label: "Notes in the margin",
    description: "AI notes and reader notes beside the passage they are about, each with Yes, Somewhat and No ratings. AI notes appear once the article is fact-checked.",
  },
  {
    id: "highlight",
    label: "Highlight text",
    description: "When a reader selects words, a small toolbar appears right above them.",
    children: [
      { id: "highlight.note", label: "Write a note on the words", description: "A note anchored to exactly the selected words." },
      { id: "highlight.forecast", label: "Add a forecast", description: "\"This is a forecast of a N% chance of …\", rated by other readers." },
      { id: "highlight.keyPoint", label: "Add a key point", description: "\"A key point in this article is …\", rated by other readers." },
      { id: "highlight.askOpus", label: "Ask Opus about the words", description: "Opens the question panel with the words quoted." },
    ],
  },
  {
    id: "passage",
    label: "Passage buttons",
    description: "Buttons that appear when a reader points at or taps a paragraph.",
    children: [
      { id: "passage.note", label: "Add a note on the passage", description: "A note on the whole paragraph." },
      { id: "passage.askOpus", label: "Ask Opus about the passage", description: "Opens the question panel for the paragraph." },
    ],
  },
  {
    id: "opus",
    label: "What Opus may do",
    description: "Applies wherever Ask Opus is on. Questions are paid from the daily budget for reader requests.",
    children: [
      { id: "opus.search", label: "Search the web", description: "Searches as often as it needs, and cites what it uses as links." },
      { id: "opus.drafts", label: "Draft forecasts and key points", description: "Shows a draft card the reader can post or edit. Only for the kinds switched on above." },
    ],
  },
  {
    id: "contents",
    label: "Table of contents",
    description: "Links to the article's section headings.",
  },
] as const satisfies readonly FeatureNode[];

type IdsOf<N> = N extends { id: infer I; children: readonly (infer C)[] } ? I | IdsOf<C> : N extends { id: infer I } ? I : never;

export type FeatureId = IdsOf<(typeof FEATURE_TREE)[number]>;

function collectIds(nodes: readonly FeatureNode[]): FeatureId[] {
  return nodes.flatMap((node) => [node.id as FeatureId, ...collectIds(node.children ?? [])]);
}

/** Every feature. The plain /read?url= page uses all of them. */
export const ALL_FEATURES: readonly FeatureId[] = collectIds(FEATURE_TREE);

/** The features in effect for a stored list. A child counts only while its
 *  parent is on. Opus's abilities count only where readers can ask Opus at
 *  all, and drafting only while a highlight kind it can draft is on. */
export function enabledFeatures(stored: readonly string[]): ReadonlySet<FeatureId> {
  const picked = new Set(stored);
  const on = new Set<FeatureId>();
  const walk = (nodes: readonly FeatureNode[]) => {
    for (const node of nodes) {
      if (!picked.has(node.id)) continue;
      on.add(node.id as FeatureId);
      walk(node.children ?? []);
    }
  };
  walk(FEATURE_TREE);
  if (!on.has("highlight.askOpus") && !on.has("passage.askOpus")) {
    on.delete("opus");
    on.delete("opus.search");
    on.delete("opus.drafts");
  }
  if (!on.has("highlight.forecast") && !on.has("highlight.keyPoint")) on.delete("opus.drafts");
  return on;
}
