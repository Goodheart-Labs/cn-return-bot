import { useEffect, useMemo, useState } from "react";
import { TweetCard } from "../../../dashboard-shared/TweetCard";
import { OurNoteCard } from "../../../dashboard-shared/OurNoteCard";
import { CompetingNoteCard } from "../../../dashboard-shared/CompetingNoteCard";
import { results, loadSource, type SimilarTweet, type NoteView } from "../lib/similarityData";

function NoteItem({ note }: { note: NoteView }) {
  return note.isOurs ? (
    <OurNoteCard noteId={note.noteId} noteText={note.noteText} />
  ) : (
    <CompetingNoteCard noteId={note.noteId} noteText={note.noteText} status={note.status} />
  );
}

function SimilarTweetCard({ item }: { item: SimilarTweet }) {
  const pct = (item.similarity * 100).toFixed(1);
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 rounded px-2 py-0.5">
          {pct}% similar
        </span>
        {item.notes.length > 0 && (
          <span className="text-xs text-gray-500">
            {item.notes.length} note{item.notes.length > 1 ? "s" : ""}
          </span>
        )}
        <a
          href={`https://x.com/i/status/${item.tweetId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:underline ml-auto"
        >
          Open tweet ↗
        </a>
      </div>
      {item.tweet ? (
        <TweetCard tweet={item.tweet} />
      ) : (
        <div className="text-sm text-gray-400">Tweet {item.tweetId} not found</div>
      )}
      {item.notes.length > 0 && (
        <div className="mt-2 space-y-2">
          {item.notes.map((n) => (
            <NoteItem key={n.noteId} note={n} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SimilarityPanel() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [onlyWithNotes, setOnlyWithNotes] = useState(false);
  const [sourceTweet, setSourceTweet] = useState<SimilarTweet["tweet"]>(undefined);
  const [similar, setSimilar] = useState<SimilarTweet[]>([]);
  const [loading, setLoading] = useState(false);

  const source = results.sources[selectedIdx];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSource(source)
      .then((res) => {
        if (cancelled) return;
        setSourceTweet(res.source);
        setSimilar(res.similar);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedIdx]);

  const shown = useMemo(
    () => (onlyWithNotes ? similar.filter((s) => s.notes.length > 0) : similar),
    [similar, onlyWithNotes],
  );

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="mb-3 text-sm text-gray-600">
        <span className="font-medium">{results.model}</span> · {results.dims}d · corpus{" "}
        {results.corpusSize} tweets ({results.corpusWithNotes} with notes) · generated{" "}
        {new Date(results.generatedAt).toLocaleString()}
      </div>

      {/* Source picker — single horizontally-scrollable row */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {results.sources.map((s, i) => (
          <button
            key={s.tweetId}
            onClick={() => setSelectedIdx(i)}
            className={`shrink-0 text-xs px-2 py-1 rounded border max-w-xs truncate ${
              i === selectedIdx
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
            title={s.text}
          >
            {i + 1}. {s.text?.slice(0, 40) || s.tweetId}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: source tweet */}
        <div className="md:sticky md:top-4 self-start">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Source tweet (today)</h2>
          {sourceTweet ? (
            <TweetCard tweet={sourceTweet} />
          ) : (
            <div className="text-sm text-gray-400">{source.text || source.tweetId}</div>
          )}
          <a
            href={`https://x.com/i/status/${source.tweetId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline"
          >
            Open source tweet ↗
          </a>
        </div>

        {/* Right: similar past tweets */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">
              Most similar past tweets ({shown.length})
            </h2>
            <label className="text-xs text-gray-600 flex items-center gap-1">
              <input
                type="checkbox"
                checked={onlyWithNotes}
                onChange={(e) => setOnlyWithNotes(e.target.checked)}
              />
              only with notes
            </label>
          </div>
          {loading ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : (
            <div className="space-y-3">
              {shown.map((item) => (
                <SimilarTweetCard key={item.tweetId} item={item} />
              ))}
              {shown.length === 0 && (
                <div className="text-sm text-gray-400">No similar tweets match the filter.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
