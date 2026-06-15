/**
 * Exit 0 if the X API /2/tweets read endpoint is up (control tweet fetch
 * succeeds), exit 1 otherwise. Used by an until-loop to wait out the 503 outage.
 */
import "dotenv/config";
import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const P = "X_NATHANPMYOUNG";
for (const s of ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"]) {
  process.env[`X_${s}`] = process.env[`${P}_${s}`];
}

const url = "https://api.x.com/2/tweets/20?tweet.fields=created_at";
try {
  const res = await axios.get(url, {
    headers: { ...getOAuth1Headers(url, "GET"), "Content-Type": "application/json" },
    timeout: 20000,
  });
  console.log(`up ${res.status}`);
  process.exit(0);
} catch (err: any) {
  console.log(`down ${err?.response?.status ?? err?.code}`);
  process.exit(1);
}
