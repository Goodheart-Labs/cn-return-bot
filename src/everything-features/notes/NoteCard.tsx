import type { NnnRow, NoteRow } from "@cn/core/types";
import { Card } from "@cn/ui/Card";
import { Note } from "./Note";
import { NoteNotNeeded } from "./NoteNotNeeded";

export function NoteCard({ note, shareUrl, nnnEntries = [], compact, onDeleted }: {
  note: NoteRow;
  shareUrl: string;
  nnnEntries?: NnnRow[];
  compact?: boolean;
  onDeleted?: () => void;
}) {
  return (
    <Card className={compact ? "min-w-0 p-4" : "mx-auto w-full max-w-[40rem] p-4"}>
      {note.claim.image_urls.length > 0 && <div className="mb-3 flex flex-wrap gap-2">
        {note.claim.image_urls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Claim source" loading="lazy" className="max-h-48 max-w-full rounded-control" /></a>)}
      </div>}
      {note.claim.context_quote && <blockquote className="mb-3 border-l-2 border-line pl-3 text-sm text-fg-secondary">{note.claim.context_quote}</blockquote>}
      {note.claim.context_paragraph && <details className="mb-3 text-xs text-fg-muted"><summary className="cursor-pointer">Surrounding context</summary><p className="mt-2 whitespace-pre-wrap">{note.claim.context_paragraph}</p></details>}
      <Note note={note} shareUrl={shareUrl} onDeleted={onDeleted} />
      <NoteNotNeeded entries={nnnEntries} />
    </Card>
  );
}
