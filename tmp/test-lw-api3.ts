// Explore LessWrong GraphQL schema - mutations for posts and comments
const FULL_COOKIE = `clientId=G6acrKLJXQbfdMvAM; loginToken=74e599487ad689a20bc28a5080cb4da2c753c2e5deb9c27eb13ab17ff58f652e; _vcrcs=1.1770911314.3600.ZWY5ZjI1ZGZmNTFiZDhkNmI0MTRhYjU0NDkwYjUwMDY=.01f3bf630745e5c6eb49595267f684f4; timezone=Europe/London`;

async function query(gql: string) {
  const res = await fetch("https://www.lesswrong.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": FULL_COOKIE,
      "User-Agent": "Mozilla/5.0",
      "Origin": "https://www.lesswrong.com",
    },
    body: JSON.stringify({ query: gql }),
  });
  return res.json();
}

async function main() {
  // 1. Find all mutations
  console.log("=== All Mutations ===");
  const schema = await query(`{
    __schema {
      mutationType {
        fields { name }
      }
    }
  }`);
  const mutations = schema.data.__schema.mutationType.fields.map((f: any) => f.name);
  console.log(mutations.filter((n: string) => /post|comment|shortform|quick/i.test(n)));
  console.log("\nAll mutations:", mutations.join(", "));

  // 2. Inspect createPost
  console.log("\n=== createPost mutation args ===");
  const createPost = await query(`{
    __type(name: "CreatePostDataInput") {
      inputFields { name type { name kind ofType { name kind ofType { name } } } }
    }
  }`);
  console.log(JSON.stringify(createPost.data, null, 2));

  // 3. Inspect createComment
  console.log("\n=== createComment mutation args ===");
  const createComment = await query(`{
    __type(name: "CreateCommentDataInput") {
      inputFields { name type { name kind ofType { name kind ofType { name } } } }
    }
  }`);
  console.log(JSON.stringify(createComment.data, null, 2));

  // 4. Get the actual mutation signature
  console.log("\n=== createPost mutation signature ===");
  const postMut = await query(`{
    __schema {
      mutationType {
        fields(includeDeprecated: true) {
          name
          args { name type { name kind ofType { name kind ofType { name } } } }
        }
      }
    }
  }`);
  const postField = postMut.data.__schema.mutationType.fields.find((f: any) => f.name === "createPost");
  const commentField = postMut.data.__schema.mutationType.fields.find((f: any) => f.name === "createComment");
  console.log("createPost args:", JSON.stringify(postField, null, 2));
  console.log("\ncreateComment args:", JSON.stringify(commentField, null, 2));
}

main().catch(console.error);
