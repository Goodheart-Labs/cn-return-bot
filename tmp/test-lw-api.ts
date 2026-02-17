// Test LessWrong GraphQL API
const LOGIN_TOKEN = "74e599487ad689a20bc28a5080cb4da2c753c2e5deb9c27eb13ab17ff58f652e";
const ENDPOINT = "https://www.lesswrong.com/api/streamGraphql";

async function query(gql: string, variables?: Record<string, any>) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cookie": `loginToken=${LOGIN_TOKEN}`,
    },
    body: JSON.stringify({ query: gql, variables }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000), status: res.status };
  }
}

async function main() {
  // 1. Test auth - who am I?
  console.log("=== Current User ===");
  const user = await query(`{ currentUser { _id displayName username } }`);
  console.log(JSON.stringify(user, null, 2));

  // 2. List available mutations related to posts/comments
  console.log("\n=== Post/Comment Mutations ===");
  const schema = await query(`{
    __schema {
      mutationType {
        fields {
          name
          args { name type { name kind ofType { name kind } } }
        }
      }
    }
  }`);

  if (schema?.data?.__schema?.mutationType?.fields) {
    const relevant = schema.data.__schema.mutationType.fields.filter(
      (f: any) => /post|comment|shortform/i.test(f.name)
    );
    for (const m of relevant) {
      console.log(`\n${m.name}(`);
      for (const arg of m.args) {
        const typeName = arg.type.name || arg.type.ofType?.name || arg.type.kind;
        console.log(`  ${arg.name}: ${typeName}`);
      }
      console.log(`)`);
    }
  } else {
    console.log("Schema introspection failed:", JSON.stringify(schema, null, 2).slice(0, 1000));
  }

  // 3. Look at createComment input type specifically
  console.log("\n=== CreateComment Input Type ===");
  const commentType = await query(`{
    __type(name: "CreateCommentDataInput") {
      name
      inputFields { name type { name kind ofType { name kind } } }
    }
  }`);
  console.log(JSON.stringify(commentType, null, 2));

  // 4. Look at createPost input type
  console.log("\n=== CreatePost Input Type ===");
  const postType = await query(`{
    __type(name: "CreatePostDataInput") {
      name
      inputFields { name type { name kind ofType { name kind } } }
    }
  }`);
  console.log(JSON.stringify(postType, null, 2));
}

main().catch(console.error);
