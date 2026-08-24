import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    topics: z.array(z.string()).min(1),
    draft: z.boolean().default(false),
  }),
});

const topics = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/topics" }),
  schema: z.object({
    name: z.string(),
    description: z.string(),
    order: z.number().int().default(100),
  }),
});

export const collections = { blog, topics };
