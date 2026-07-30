import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../assets/tailwind.css";
import { browser } from "#imports";
import { hostnamePattern, registerGenericScripts } from "../../utils/genericScript";
import { addDismissedGrantHost } from "../../utils/settings";

// Redirect-mode consent page: the background detours a navigation to a noted
// site here, because a permission request needs a user gesture — the Allow
// click below is that gesture. Either choice returns to the page the user
// was headed to.
const params = new URLSearchParams(location.search);
const host = params.get("host") ?? "";

/** Only ever bounce back to an http(s) URL on the host being asked about —
 *  the `back` param rides an extension-page URL and must not become an open
 *  redirect to javascript: or another site. */
const back = (() => {
  try {
    const url = new URL(params.get("back") ?? "");
    if (/^https?:$/.test(url.protocol) && url.hostname === host) return url.toString();
  } catch {
    // fall through to the host's front page
  }
  return `https://${host}/`;
})();

function GrantApp() {
  const [busy, setBusy] = useState(false);

  const allow = async () => {
    setBusy(true);
    const granted = await browser.permissions.request({ origins: [hostnamePattern(host)] }).catch(() => false);
    if (granted) {
      await registerGenericScripts([host]);
      location.href = back;
      return;
    }
    // Native prompt denied/closed — stay so they can retry or pick Not now.
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
        <p className="text-sm text-gray-600">
          There are community notes for pages on <span className="font-medium text-gray-800">{host}</span>.
          Allow Common Notes to run there to see them inline.
        </p>
        <div className="space-y-2">
          <button onClick={allow} disabled={busy} className="w-full bg-blue-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
            Show notes on {host}
          </button>
          <button onClick={notNow} disabled={busy} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100">
            Not now
          </button>
        </div>
        <p className="text-xs text-gray-400">
          "Not now" remembers your choice for this site — you won't be asked again.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<GrantApp />);
