import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../assets/tailwind.css";
import { browser } from "#imports";
import { hostnamePattern, registerGenericScripts } from "../../utils/genericScript";
import { addDismissedGrantHost } from "../../utils/settings";

// This is the consent page used in redirect mode. The background detours a
// navigation to a noted site here, because a permission request needs a user
// gesture. The click on the Allow button below is that gesture. Either button
// returns the user to the page they were headed to.
const params = new URLSearchParams(location.search);
const host = params.get("host") ?? "";

/** We only ever bounce back to an http or https URL on the host we are asking
 *  about. The `back` parameter arrives on an extension page URL, so it must
 *  not be able to send the user anywhere else, such as a javascript: URL or
 *  another site. */
const back = (() => {
  try {
    const url = new URL(params.get("back") ?? "");
    if (/^https?:$/.test(url.protocol) && url.hostname === host) return url.toString();
  } catch {
    // The parameter is unusable, so we fall through to the host's front page.
  }
  return `https://${host}/`;
})();

function GrantApp() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      // A thrown error here is a real bug, not the user declining. One cause
      // is an MV2 manifest without optional_permissions. We show it rather
      // than swallow it, because a swallowed error leaves a button that looks
      // dead.
      const granted = await browser.permissions.request({ origins: [hostnamePattern(host)] });
      if (granted) {
        await registerGenericScripts([host]);
        location.href = back;
        return;
      }
    } catch (err) {
      setError((err as Error).message);
    }
    // The browser's own prompt was denied or closed. We stay on this page so
    // the user can retry or pick the other button.
    setBusy(false);
  };

  const notNow = async () => {
    await addDismissedGrantHost(host);
    location.href = back;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 max-w-md w-full space-y-4">
        <h1 className="text-lg font-extrabold text-gray-900">This site has Common Notes</h1>
        <div className="space-y-2">
          <button onClick={allow} disabled={busy} className="w-full bg-blue-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
            Show notes on {host}
          </button>
          <button onClick={notNow} disabled={busy} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100">
            Do not ask again
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<GrantApp />);
