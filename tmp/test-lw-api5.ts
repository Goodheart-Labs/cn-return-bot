// Check ContentTypeInput and then create a draft post as test
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
  // 1. ContentTypeInput schema
  console.log("=== ContentTypeInput ===");
  const contentType = await query(`{
    __type(name: "ContentTypeInput") {
      inputFields { name type { name kind ofType { name kind } } }
    }
  }`);
  console.log(JSON.stringify(contentType.data, null, 2));

  // 2. PostCategory enum values
  console.log("\n=== PostCategory enum ===");
  const postCat = await query(`{
    __type(name: "PostCategory") {
      enumValues { name }
    }
  }`);
  console.log(JSON.stringify(postCat.data, null, 2));

  // 3. Try creating a DRAFT post (won't be published)
  console.log("\n=== Creating test draft post ===");
  const result = await query(`
    mutation CreatePost($data: CreatePostDataInput!) {
      createPost(data: $data) {
        data {
          _id
          title
          draft
          url
          slug
        }
      }
    }
  `, {
    data: {
      title: "[TEST - DELETE ME] API Draft Test",
      draft: true,
      contents: {
        originalContents: {
          type: "markdown",
          data: "This is a test post created via the GraphQL API. Please delete."
        }
      }
    }
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
