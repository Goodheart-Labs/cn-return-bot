import { useState } from "react";
import { castVote, getMyVotes, type Vote } from "../lib/votes";
import type { NoteRow } from "../lib/types";

export function VoteButtons({ note }: { note: NoteRow }) {
  const [myVote, setMyVote] = useState<Vote | undefined>(() => getMyVotes()[note.id]);

  const vote = (v: Vote) => {
    if (v === myVote) return;
    setMyVote(v);
    castVote(note.id, v).catch((err) => console.error("vote failed:", err));
  };

  const buttonClass = (active: boolean) =>
    `px-3 py-1 rounded-full text-sm border transition-colors ${
      active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
    }`;

  // Counts come from the DB (updated live via realtime); the button highlight is local.
  return (
    <div className="flex gap-2 items-center">
      <button className={buttonClass(myVote === 1)} onClick={() => vote(1)}>
        👍 Helpful {note.helpful_count > 0 && <span className="font-semibold">{note.helpful_count}</span>}
      </button>
      <button className={buttonClass(myVote === -1)} onClick={() => vote(-1)}>
        👎 Not helpful {note.not_helpful_count > 0 && <span className="font-semibold">{note.not_helpful_count}</span>}
      </button>
    </div>
  );
}
