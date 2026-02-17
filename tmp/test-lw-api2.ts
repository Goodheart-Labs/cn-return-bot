// Test LessWrong GraphQL API with full cookies
const FULL_COOKIE = `clientId=G6acrKLJXQbfdMvAM; loginToken=74e599487ad689a20bc28a5080cb4da2c753c2e5deb9c27eb13ab17ff58f652e; _vcrcs=1.1770911314.3600.ZWY5ZjI1ZGZmNTFiZDhkNmI0MTRhYjU0NDkwYjUwMDY=.01f3bf630745e5c6eb49595267f684f4; timezone=Europe/London`;

const ENDPOINT = "https://www.lesswrong.com/api/streamGraphql";

async function query(gql: string, variables?: Record<string, any>) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cookie": FULL_COOKIE,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      "Origin": "https://www.lesswrong.com",
      "Referer": "https://www.lesswrong.com/",
    },
    body: JSON.stringify({ query: gql, variables }),
  });
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500), status: res.status };
  }
}

async function main() {
  // Test with the non-streaming endpoint too
  console.log("=== Testing /graphql endpoint ===");
  const res1 = await fetch("https://www.lesswrong.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": FULL_COOKIE,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Origin": "https://www.lesswrong.com",
    },
    body: JSON.stringify({ query: `{ currentUser { _id displayName username } }` }),
  });
  const text1 = await res1.text();
  console.log(`Status: ${res1.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text1), null, 2));
  } catch {
    console.log(text1.slice(0, 500));
  }

  // Test streaming endpoint
  console.log("\n=== Testing /api/streamGraphql endpoint ===");
  const user = await query(`{ currentUser { _id displayName username } }`);
  console.log(JSON.stringify(user, null, 2));
}

main().catch(console.error);
