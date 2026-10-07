---
title: "Generate pages from content"
description: "Turn a small content collection into static routes and learn when client navigation is worth adding."
stage: "Build the frontend"
duration: 35
lab: "Local View project"
order: 11
---

Before you start: complete [Publish a small static website](/learn/static-website/), or make sure you can pass its checkpoint.

## Start from data rather than copied pages

Create two article records in a page module. Each record owns a stable slug, a title and a summary. Use `definePages` to return the page definitions:

```tsx
// File: learn-view/src/pages/journal.tsx
import { definePages } from '@ketvietlab/ketjs-view-tools'

const articles = [
  { slug: 'first-build', title: 'My first build', summary: 'A page and one interactive island.' },
  { slug: 'first-api', title: 'My first API', summary: 'A module with a validated operation.' },
]

export default definePages(articles.map(article => ({
  path: `/journal/${article.slug}/`,
  head: { title: article.title, description: article.summary, lang: 'en' },
  view: () => <main><a href="/">Home</a><h1>{article.title}</h1><p>{article.summary}</p></main>,
})))
```

## Replace the array with Markdown later

A Markdown pipeline belongs at build time: read files, parse frontmatter, validate unique slugs, render Markdown, and sanitize HTML before passing it to `trustedMarkup`. A parser alone does not establish trust. Reject duplicate routes instead of letting one file overwrite another.

Keep title and description in the content model so HTML metadata and the visible article agree. For headings, create stable unique anchors and use those same IDs in the table of contents. Images need alt text; internal links should be checked against generated routes.

## Keep native navigation as the baseline

The two links work without JavaScript. That is a useful first checkpoint. Client navigation becomes worthwhile when you want to preserve a surrounding shell or local UI while changing an article.

If you add it, fetch structured content and update a page signal inside an island. Update history, the document title, canonical metadata, focus and scroll position together. Handle Back/Forward, modified clicks, failed fetches and rapid consecutive navigation. Abort stale requests so an older response cannot overwrite the latest article.

## Compare first load with subsequent navigation

Static generation still supplies the first page's content. The island is an enhancement over that HTML, not a replacement for it. Direct links and refreshes must continue to work after adding client navigation.

## Checkpoint

Both journal routes are generated with distinct metadata and can be opened directly. Slugs stay stable when titles change.

## Practice on your own

Add a third article and a native article index. Then write down the extra responsibilities a client-side navigation enhancement would introduce.

## Reference

For the complete API contract, read [View Static Sites](/docs/view-static-sites/).
