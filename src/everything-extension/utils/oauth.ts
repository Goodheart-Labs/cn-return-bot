import { browser } from "#imports";
import { supabase } from "../../everything-shared/supabase";

/** X sign-in from the background: Supabase builds the provider URL
 *  (skipBrowserRedirect — we drive the window ourselves), launchWebAuthFlow
 *  runs the OAuth dance in a popup window, and the tokens come back on the
 *  extension redirect URL's hash (implicit flow) for setSession.
 *
 *  Requires the extension redirect URL (browser.identity.getRedirectURL(),
 *  chromiumapp.org / extensions.allizom.org) on the Supabase redirect
 *  allow-list. */
export async function signInWithXViaWebAuthFlow(): Promise<{ ok: boolean; error?: string }> {
  try {
    const redirectTo = browser.identity.getRedirectURL();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "twitter",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data?.url) return { ok: false, error: error?.message ?? "could not start OAuth" };

    const resultUrl = await browser.identity.launchWebAuthFlow({ url: data.url, interactive: true });
    if (!resultUrl) return { ok: false, error: "sign-in window closed" };

    const params = new URLSearchParams(new URL(resultUrl).hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) {
      return { ok: false, error: params.get("error_description") ?? "no tokens in OAuth redirect" };
    }
    const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
    if (sessionError) return { ok: false, error: sessionError.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
