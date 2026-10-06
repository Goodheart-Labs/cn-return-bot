import { createContext, useContext, type ComponentType } from "react";
import type { PageItem } from "@cn/core/items";
import type { FeatureId } from "@cn/core/minisiteFeatures";
import type { HighlightDraft, PassageHighlight } from "@cn/core/passageHighlights";
import type { ReaderBlock } from "@cn/core/readerText";
import type { NnnRow, NoteRow } from "@cn/core/types";

/** The words a note, key point or question is about, and the paragraph they
 *  come from. `partial` says whether the reader selected words or took the
 *  whole passage. */
export interface ReaderAnchor {
  blockId: string;
  text: string;
  paragraph: string;
  partial: boolean;
}

/** The dialog the reader has open. Each kind belongs to one feature module. */
export type ReaderDialog =
  | { kind: "note"; anchor: ReaderAnchor }
  | { kind: "highlight"; anchor: ReaderAnchor; highlightKind: HighlightDraft["kind"]; draft?: HighlightDraft };

/** The passage the Ask Opus panel is open on, and the words quoted in it. */
export interface AskingState {
  blockId: string;
  quote: string | null;
}

/** The id of the margin group that holds entries we could not place beside a
 *  passage. */
export const UNANCHORED = "unanchored";

/** Everything the shell shares with the feature modules. */
export interface ReaderApi {
  item: PageItem;
  scope: string;
  blocks: readonly ReaderBlock[];
  features: ReadonlySet<FeatureId>;
  /** Wide screens show entries in the margin. Narrow ones show them inline,
   *  under the passage the reader opened. */
  wide: boolean;
  notesByBlock: ReadonlyMap<string, NoteRow[]>;
  /** Readers' arguments that a claim needs no note, shown under that note. */
  nnnEntries: readonly NnnRow[];
  highlightsByBlock: ReadonlyMap<string, PassageHighlight[]>;
  refetchHighlights: () => void;
  asking: AskingState | null;
  openAsk: (block: ReaderBlock, quote: string | null) => void;
  closeAsk: () => void;
  dialog: ReaderDialog | null;
  openDialog: (dialog: ReaderDialog) => void;
  closeDialog: () => void;
  /** Shows a short message at the bottom of the screen. */
  notify: (message: string) => void;
  /** Scrolls to an entry's card once it has rendered, and outlines it. On a
   *  narrow screen it first opens the passage the card sits under. */
  reveal: (elementId: string, blockId?: string) => void;
}

export const ReaderContext = createContext<ReaderApi | null>(null);

export function useReader(): ReaderApi {
  const api = useContext(ReaderContext);
  if (!api) throw new Error("useReader is only available inside the reader");
  return api;
}

/** A button the shell shows on selected words or under a passage. It only
 *  appears while its feature is on. */
export interface ReaderAction {
  feature: FeatureId;
  key: string;
  label: string;
  accessibleName: string;
  onSelect: () => void;
}

/** One feature module. Each slot is optional. The shell fills the slots of
 *  every module and drops actions whose feature is off. A module's components
 *  check their own features and render nothing when off. */
export interface ReaderModule {
  name: string;
  /** Buttons in the toolbar above selected words. `quote` is the selection
   *  widened to whole words. */
  selectionActions?: (api: ReaderApi, block: ReaderBlock, quote: string) => ReaderAction[];
  /** Buttons that appear when the reader points at or taps a passage. */
  passageActions?: (api: ReaderApi, block: ReaderBlock) => ReaderAction[];
  /** How many entries this module shows beside a passage. */
  marginCount?: (api: ReaderApi, blockId: string) => number;
  /** The entries beside one passage, or beside the unanchored section. */
  MarginEntries?: ComponentType<{ blockId: string }>;
  /** A rail to the left of the article on wide screens. */
  Rail?: ComponentType;
  /** Dialogs the module opens. */
  Dialogs?: ComponentType;
}
