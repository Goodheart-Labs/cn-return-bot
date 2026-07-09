import type { NoteRow } from "../lib/types";
import type { Vote } from "../lib/votes";

export function VoteButtons({ note, myVote, onVote }: {
  note: NoteRow;
  myVote: Vote | undefined;
  onVote: (note: NoteRow, vote: Vote) => void;
}) {
  const buttonClass = (active: boolean) =>
    `px-3 py-1 rounded-full text-sm border transition-colors ${
      active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
    }`;

  return (
    <div className="flex gap-2 items-center">
      <button className={buttonClass(myVote === 1)} onClick={() => onVote(note, 1)}>
        👍 Helpful {note.helpful_count > 0 && <span className="font-semibold">{note.helpful_count}</span>}
      </button>
      <button className={buttonClass(myVote === -1)} onClick={() => onVote(note, -1)}>
        👎 Not helpful {note.not_helpful_count > 0 && <span className="font-semibold">{note.not_helpful_count}</span>}
      </button>
    </div>
  );
}
