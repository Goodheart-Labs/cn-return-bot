import { useLiveData } from "./lib/useLiveData";
import { ItemCard } from "./components/ItemCard";
import type { ClaimRow } from "./lib/types";

export function App() {
  const { items, claims, notes, loaded } = useLiveData();

  const claimsByItem = new Map<string, ClaimRow[]>();
  for (const claim of claims.values()) {
    const list = claimsByItem.get(claim.item_id) ?? [];
    list.push(claim);
    claimsByItem.set(claim.item_id, list);
  }
  const notesByClaim = new Map([...notes.values()].map((n) => [n.claim_id, n]));

  const sortedItems = [...items.values()].sort((a, b) =>
    (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at),
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Community Notes on Everything</h1>
        <p className="text-gray-500">
          AI-generated community notes on podcasts, articles, and more — vote on whether they're helpful.
        </p>
      </header>
      {!loaded && <p className="text-gray-400">Loading…</p>}
      {loaded && sortedItems.length === 0 && <p className="text-gray-400">Nothing here yet.</p>}
      <div className="space-y-10">
        {sortedItems.map((item) => (
          <ItemCard key={item.id} item={item} claims={claimsByItem.get(item.id) ?? []} notesByClaim={notesByClaim} />
        ))}
      </div>
    </div>
  );
}
