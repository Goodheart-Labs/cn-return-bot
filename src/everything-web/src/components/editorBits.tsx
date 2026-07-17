import type { Session } from "@supabase/supabase-js";
import { displayName } from "../lib/session";

/** Shared pieces of the small inline editors (improve a note, reply to a
 *  comment, explain a vote): auto-growing textarea, the opt-in byline
 *  checkbox, and the judge-rejected notice. */

export function AutoGrowTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      ref={(el) => {
        if (el) {
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }
      }}
      className={`w-full resize-none overflow-hidden border border-gray-300 rounded-lg px-3 py-2 text-sm ${className ?? ""}`}
    />
  );
}

/** Bylines are opt-in (Nathan, 2026-07-14): default anonymous, X-CN style —
 *  note-writing is adversarial work and auto-bylines were a consent gap. */
export function PostAsCheckbox({ signed, onChange, session, className }: {
  signed: boolean;
  onChange: (signed: boolean) => void;
  session: Session;
  className?: string;
}) {
  return (
    <label className={`flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer ${className ?? ""}`}>
      <input type="checkbox" checked={signed} onChange={(e) => onChange(e.target.checked)} />
      Post as {displayName(session)}
    </label>
  );
}

export function RejectedNotice({ children }: { children?: React.ReactNode }) {
  return (
    <p className="text-sm rounded-lg p-2 bg-amber-50 text-amber-800 border border-amber-200">
      {children ?? "That didn't look like a genuine note — try again."}
    </p>
  );
}
