import { mkdir, writeFile } from "node:fs/promises";
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

const name = words.join(" ").trim();
if (!name) {
  console.error('Usage: npm run topic -- "Topic Name" --description "Description"');
  process.exit(1);
}

const slug =
  flags.slug ??
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const order = Number.parseInt(flags.order ?? "100", 10);
if (!Number.isInteger(order)) {
  console.error("--order must be an integer");
  process.exit(1);
}

const file = path.join("src", "content", "topics", `${slug}.json`);
if (existsSync(file)) {
  console.error(`Already exists: ${file}`);
  process.exit(1);
}

const topic = {
  name,
  description: flags.description ?? "Describe what readers will find in this topic.",
  order,
};

await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, `${JSON.stringify(topic, null, 2)}\n`, "utf8");
console.log(`Created ${file}`);
console.log(`Use it in a post with: --topics ${slug}`);
