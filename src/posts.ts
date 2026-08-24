import { getCollection, type CollectionEntry } from "astro:content";
import { site } from "./site";

export type Post = CollectionEntry<"blog">;
export type Topic = CollectionEntry<"topics">;

export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection("blog", ({ data }) =>
    import.meta.env.DEV ? true : !data.draft,
  );
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export async function getTopics(): Promise<Topic[]> {
  const topics = await getCollection("topics");
  return topics.sort(
    (a, b) => a.data.order - b.data.order || a.data.name.localeCompare(b.data.name),
  );
}

export function editUrl(post: Post) {
  return `${site.repo}/edit/${site.branch}/src/content/blog/${post.filePath?.split("/").pop() ?? `${post.id}.md`}`;
}

const postTemplate = `---
title: "New post"
description: "One-sentence summary."
pubDate: ${new Date().toISOString().slice(0, 10)}
topics:
  - security
draft: true
---

Write here. Set draft to false when ready to publish.
`;

const topicTemplate = `{
  "name": "New Topic",
  "description": "What readers will find in this topic.",
  "order": 100
}
`;

export const newPostUrl =
  `${site.repo}/new/${site.branch}/src/content/blog` +
  `?filename=new-post.md&value=${encodeURIComponent(postTemplate)}`;

export const newTopicUrl =
  `${site.repo}/new/${site.branch}/src/content/topics` +
  `?filename=new-topic.json&value=${encodeURIComponent(topicTemplate)}`;

export function topicMap(topics: Topic[]) {
  return new Map(topics.map((topic) => [topic.id, topic]));
}

export function postsForTopic(posts: Post[], topicId: string) {
  return posts.filter((post) => post.data.topics.includes(topicId));
}

export function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatLongDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
