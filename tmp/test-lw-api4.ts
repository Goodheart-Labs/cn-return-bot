// Explore contents format and test reading a quick take
const FULL_COOKIE = `clientId=G6acrKLJXQbfdMvAM; loginToken=74e599487ad689a20bc28a5080cb4da2c753c2e5deb9c27eb13ab17ff58f652e; _vcrcs=1.1770911314.3600.ZWY5ZjI1ZGZmNTFiZDhkNmI0MTRhYjU0NDkwYjUwMDY=.01f3bf630745e5c6eb49595267f684f4; timezone=Europe/London`;

async function query(gql: string, variables?: Record<string, any>) {
  const res = await fetch("https://www.lesswrong.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": FULL_COOKIE,
      "User-Agent": "Mozilla/5.0",
      "Origin": "https://www.lesswrong.com",
    },
    body: JSON.stringify({ query: gql, variables }),
  });
  return res.json();
}

async function main() {
  // 1. What does CreateRevisionDataInput look like? (used for contents field)
  console.log("=== CreateRevisionDataInput ===");
  const revType = await query(`{
    __type(name: "CreateRevisionDataInput") {
      inputFields { name type { name kind ofType { name kind } } }
    }
  }`);
  console.log(JSON.stringify(revType.data, null, 2));

  // 2. Fetch my recent shortform/quick-take comments to understand the format
  console.log("\n=== My recent quick takes ===");
  const quickTakes = await query(`{
    comments(input: {
      terms: {
        view: "profileComments",
        userId: "cJnvyeYrotgZgfG8W",
        shortform: true,
        limit: 2
      }
    }) {
      results {
        _id
        shortform
        contents { html markdown }
        postId
        createdAt
      }
    }
  }`);
  console.log(JSON.stringify(quickTakes.data, null, 2));

  // 3. Fetch my recent posts
  console.log("\n=== My recent posts ===");
  const posts = await query(`{
    posts(input: {
      terms: {
        view: "userPosts",
        userId: "cJnvyeYrotgZgfG8W",
        limit: 3
      }
    }) {
      results {
        _id
        title
        draft
        shortform
        createdAt
        url
      }
    }
  }`);
  console.log(JSON.stringify(posts.data, null, 2));
}

main().catch(console.error);
