# Strongerwill's Blog

Personal site for strongerwill: security, trust, innovation, and AI.

## Create a post

```bash
npm run new -- "AI agents and supply chain risk" --topics ai,security
npm run dev
```

New posts start with `draft: true`. Set `draft: false` to publish. The Blog page also provides
pre-filled **New post** and per-article **Edit this post** links for GitHub.

## Create a topic

Topics are content files, not hardcoded navigation:

```bash
npm run topic -- "Cloud Security" \
  --description "Threats and defenses across modern cloud infrastructure"
```

Each JSON file in `src/content/topics/` becomes a filter on the Blog page. Use its filename
without `.json` in a post's `topics` list. The Blog page also provides a **New topic** link.

## Post frontmatter

```md
---
title: "Your title"
description: "One-sentence summary."
pubDate: 2026-08-25
topics:
  - ai
  - security
draft: false
---
```

## Development

```bash
npm install
npm run dev
npm run build
npm run preview
```

Pushing `main` triggers `.github/workflows/deploy.yml` and deploys to GitHub Pages.
