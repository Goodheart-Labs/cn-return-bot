import crypto from "crypto";
import OAuth from "oauth-1.0a";

// The four X credentials read below come from the app's settings in the
// Twitter/X Developer Portal.
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Set this in your .env.local file or GitHub Actions secrets.`
    );
  }
  return value;
}

export function getOAuth1Headers(
  url: string,
  method: string = "GET",
  _body?: string
) {
  const consumer_key = getRequiredEnv("X_API_KEY");
  const consumer_secret = getRequiredEnv("X_API_KEY_SECRET");
  const access_token = getRequiredEnv("X_ACCESS_TOKEN");
  const access_token_secret = getRequiredEnv("X_ACCESS_TOKEN_SECRET");

  const oauth = new OAuth({
    consumer: {
      key: consumer_key,
      secret: consumer_secret,
    },
    signature_method: "HMAC-SHA1",
    hash_function(base_string, key) {
      return crypto
        .createHmac("sha1", key)
        .update(base_string)
        .digest("base64");
    },
  });

  // The request body is deliberately left out of the OAuth1 signature. This is
  // what the xurl tool does, and X accepts our requests on that basis.
  const request_data = {
    url: url,
    method: method,
  };

  const token = {
    key: access_token,
    secret: access_token_secret,
  };

  return oauth.toHeader(oauth.authorize(request_data, token));
}

// Check that the configured tokens still work. Run this file directly to use it:
// bun run src/api/getOAuthToken.ts
async function validateOAuth1Tokens() {
  try {
    const headers = getOAuth1Headers("https://api.twitter.com/2/users/me");

    const response = await fetch("https://api.twitter.com/2/users/me", {
      method: "GET",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const userData = await response.json();
      console.log("\n✅ OAuth1 tokens are valid!");
      console.log(`Authenticated as: @${userData.data.username}`);
      return true;
    } else {
      console.error("\n❌ OAuth1 tokens are invalid!");
      console.error("Response status:", response.status);
      const errorData = await response.json().catch(() => ({}));
      console.error("Error details:", errorData);
      return false;
    }
  } catch (error) {
    console.error("\n❌ Error validating OAuth1 tokens:", error);
    return false;
  }
}

if (import.meta.main) {
  validateOAuth1Tokens();
}
