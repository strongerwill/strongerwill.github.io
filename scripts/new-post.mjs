import { mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flags = {};
const words = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (!arg.startsWith("--")) {
    words.push(arg);
    continue;
  }
  const [name, inlineValue] = arg.slice(2).split("=");
  if (inlineValue !== undefined) flags[name] = inlineValue;
  else {
    flags[name] = args[i + 1];
    i += 1;
  }
}

const title = words.join(" ").trim();
if (!title) {
  console.error('Usage: npm run new -- "Post title" --topics ai,security');
  process.exit(1);
}

const slug =
  flags.slug ??
  title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const topics = (flags.topics ?? "ai,security")
  .split(",")
  .map((topic) => topic.trim().toLowerCase())
  .filter(Boolean);

const availableTopics = (await readdir(path.join("src", "content", "topics")))
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(/\.json$/, ""));
const unknownTopics = topics.filter((topic) => !availableTopics.includes(topic));

if (unknownTopics.length > 0) {
  console.error(`Unknown topic: ${unknownTopics.join(", ")}`);
  console.error(`Available topics: ${availableTopics.join(", ")}`);
  console.error('Create one first with: npm run topic -- "Topic Name"');
  process.exit(1);
}

const file = path.join("src", "content", "blog", `${slug}.md`);
if (existsSync(file)) {
  console.error(`Already exists: ${file}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const content = [
  "---",
  `title: "${title.replace(/"/g, '\\"')}"`,
  'description: "One-sentence summary shown on the home page and in RSS."',
  `pubDate: ${today}`,
  "topics:",
  ...topics.map((topic) => `  - ${topic}`),
  "draft: true",
  "---",
  "",
  "Write here. Set `draft: false` when it is ready to publish.",
  "",
].join("\n");

await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, content, "utf8");
console.log(`Created ${file}`);
