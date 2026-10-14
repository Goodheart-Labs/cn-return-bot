import { INPUT_DIR, STATE_DIR } from "./paths";

export async function buildStyles() {
  const configPath = `${STATE_DIR}/tailwind.json`;
  // These templates predate the site’s semantic palette and need Tailwind’s original colours.
  await Bun.write(configPath, JSON.stringify({ darkMode: "class", content: [`${INPUT_DIR}/feed*.ts`, `${INPUT_DIR}/markup.ts`] }));
  const input = `${STATE_DIR}/input.css`;
  await Bun.write(input, "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");
  await Bun.$`bunx --no-install tailwindcss -c ${configPath} -i ${input} -o ${STATE_DIR}/feed.css --minify`;
}
