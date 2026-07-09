import type { ClaimRow, ItemRow, NoteRow } from "../lib/types";
import { NoteCard } from "./NoteCard";

const SOURCE_BADGES: Record<ItemRow["source"], { label: string; className: string }> = {
  youtube: { label: "YouTube", className: "bg-red-100 text-red-700" },
  substack: { label: "Substack", className: "bg-orange-100 text-orange-700" },
};

function StatusChip({ item, checked, pending }: { item: ItemRow; checked: number; pending: number }) {
  if (item.status === "error") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700" title={item.error ?? ""}>error</span>;
  }
  if (item.status === "queued") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">queued</span>;
  }
  if (item.status === "processing" || pending > 0) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 animate-pulse">
        checking… {checked}/{checked + pending}
      </span>
    );
  }
  return null;
}

export function ItemCard({ item, claims, notesByClaim }: {
  item: ItemRow;
  claims: ClaimRow[];
  notesByClaim: Map<string, NoteRow>;
}) {
  const badge = SOURCE_BADGES[item.source];
  const pending = claims.filter((c) => c.status === "pending").length;
  const checked = claims.filter((c) => c.status === "no_note" || c.status === "note" || c.status === "error").length;
  const notedClaims = claims.filter((c) => notesByClaim.has(c.id));

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>{badge.label}</span>
        <a href={item.url} target="_blank" rel="noreferrer" className="text-lg font-semibold hover:underline">
          {item.title ?? item.url}
        </a>
        {item.published_at && <span className="text-sm text-gray-500">{item.published_at}</span>}
        <StatusChip item={item} checked={checked} pending={pending} />
      </div>
      {claims.length > 0 && (
        <p className="text-sm text-gray-500">
          {claims.length} claims extracted · {checked} fact-checked · {notedClaims.length} got a note
        </p>
      )}
      {notedClaims.length > 0 ? (
        <div className="space-y-3">
          {notedClaims.map((claim) => (
            <NoteCard key={claim.id} item={item} claim={claim} note={notesByClaim.get(claim.id)!} />
          ))}
        </div>
      ) : (
        item.status === "done" && <p className="text-sm text-gray-400">No notes needed on this one.</p>
      )}
    </div>
  );
}
