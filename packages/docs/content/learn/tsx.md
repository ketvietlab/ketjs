---
title: "Write a pure TSX page"
description: "Compose markup with functions, typed props, lists and accessible HTML while keeping rendering pure."
stage: "Build the frontend"
duration: 20
lab: "Browser playground"
order: 3
---

Before you start: complete [Create your first View project](/learn/first-project/), or make sure you can pass its checkpoint.

## Start with a view

Choose **Website · pure TSX** in the [playground](/playground/). The playground expects a default factory returning a view function. The local static project wraps the view with `definePage`; that wrapper supplies routing and head metadata.

Replace `src/pages/index.tsx` in your local project with:

```tsx
// File: learn-view/src/pages/index.tsx
import { definePage } from '@ketvietlab/ketjs-view-tools'

function Feature({ title, detail }: { title: string; detail: string }) {
  return <li><strong>{title}</strong><p>{detail}</p></li>
}

export default definePage({
  head: { title: 'My learning journal', description: 'A small website built with ketjs-view.', lang: 'en' },
  view: () => <main>
    <h1>My learning journal</h1>
    <ul>
      <Feature title="Pages" detail="HTML generated ahead of time." />
      <Feature title="Islands" detail="Browser behavior where it is needed." />
    </ul>
    <a href="/about/">About this project</a>
  </main>,
})
```

## Follow the data

`Feature` is a function of its props. It does not own a subscription or fetch data. Its return value is ketjs-view markup, not a DOM node. The static renderer can evaluate the same function without `window` or `document`.

Use native elements for meaning: `button` performs an action, `a` navigates, and `label` names a form control. An attractive clickable `div` does not gain keyboard behavior automatically.

## Keep rendering repeatable

Do not read localStorage, attach listeners, or start timers in a shared view. A renderer may call the view more than once, including on the server. Browser effects belong to an event handler or an island lifecycle, which we introduce later.

JSX expressions escape ordinary text. Put a string such as `<script>alert(1)</script>` inside a paragraph and inspect the result: it should remain text. `trustedMarkup` is for HTML that your application has deliberately made safe; it is not a shortcut for rendering user input.

## Make one composition change

Move the two feature objects into an array and map them to `Feature` calls. A fixed informational list is enough for this exercise. When records can move, be inserted, or retain control state, use keyed rendering from the todo lesson.

## Checkpoint

The page builds without browser globals, has one H1, and its About link works with keyboard navigation.

## Practice on your own

Add a typed `Callout` component with a title and message. Render it twice with different props; keep all effects outside its function.

## Reference

For the complete API contract, read [Rendering](/docs/rendering/).
