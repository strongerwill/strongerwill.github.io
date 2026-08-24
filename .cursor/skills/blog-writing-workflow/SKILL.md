---
name: blog-writing-workflow
description: Creates, edits, categorizes, previews, and publishes posts in Strongerwill's Astro blog. Use when the user asks to write, revise, organize, add a topic, preview, or publish blog content in this repository.
---

# Blog Writing Workflow

## Content model

- Posts: `src/content/blog/<slug>.md`
- Topics: `src/content/topics/<slug>.json`
- Post `topics` values must match topic filenames without `.json`.
- New posts use `draft: true`; publishing means changing it to `false`.

## New post

1. Apply `personal-blog-writing-coach`.
2. Confirm the thesis and select durable topics.
3. If needed, run:
   ```bash
   npm run topic -- "Topic Name" --description "What readers will find here"
   ```
4. Scaffold:
   ```bash
   npm run new -- "Post title" --topics ai,security
   ```
5. Replace placeholders, run `npm run build`, then preview with `npm run dev`.

## Topic design

Create a topic only when it can plausibly hold at least three future essays. Prefer durable domains
over temporary keywords. Avoid near-duplicates.

## Publish gate

- Coaching review passed.
- Topic slugs exist.
- Description is specific and concise.
- Links and examples work.
- `draft: false`.
- `npm run build` passes.

Do not commit or push unless explicitly requested.
