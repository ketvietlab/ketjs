import { definePage } from '@ketvietlab/ketjs-view-tools'

export default definePage({
  head: {
    title: 'About · learn-view',
    description: 'A fully static page with no hydration markers or client JavaScript of its own.',
    lang: 'en',
  },
  view: () => (
    <>
      <header class="site-header">
        <a class="brand" href="../">
          learn-view
        </a>
        <nav aria-label="Main navigation">
          <a aria-current="page" href="./">
            About
          </a>
        </nav>
      </header>
      <main>
        <article class="prose">
          <p class="eyebrow">A plain static route</p>
          <h1>Nothing to hydrate here.</h1>
          <p>
            This file becomes <code>dist/about/index.html</code> with its shared, hashed stylesheet.
          </p>
          <p>
            <a href="../">Back home</a>
          </p>
        </article>
      </main>
    </>
  ),
})
