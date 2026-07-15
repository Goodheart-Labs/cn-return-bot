import { useRef, useState } from "react";
import { signInWithEmail, signInWithTwitter } from "../lib/auth";

const X_SIGNIN_ENABLED = true;

export function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdropPress = useRef(false);

  if (!open) return null;

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const { error } = await signInWithEmail(email.trim());
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onMouseDown={(e) => { backdropPress.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (backdropPress.current && e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-extrabold">Sign in to vote</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-gray-500">Voting and suggesting improvements need a quick sign-in. Reading notes doesn't.</p>

        {sent ? (
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
            Check your email for a magic link to <span className="font-medium">{email}</span>.
          </p>
        ) : (
          <form onSubmit={sendLink} className="space-y-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button type="submit" className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700">
              Send magic link
            </button>
          </form>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {X_SIGNIN_ENABLED && (
          <>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="flex-1 border-t" /> or <span className="flex-1 border-t" />
            </div>
            <button
              onClick={() => signInWithTwitter()}
              className="w-full border border-gray-800 bg-black text-white rounded-lg py-2 text-sm font-medium hover:bg-gray-800"
            >
              Sign in with 𝕏
            </button>
          </>
        )}
      </div>
    </div>
  );
}
