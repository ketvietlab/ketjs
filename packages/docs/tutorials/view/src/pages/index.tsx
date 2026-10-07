import { definePage, island } from '@ketvietlab/ketjs-view-tools'
import counter from '../islands/counter.tsx'

export default definePage({
  head: {
    title: 'learn-view',
    description: 'A static site powered by ketjs-view.',
    lang: 'en',
    links: [{ rel: 'icon', href: './favicon.svg', type: 'image/svg+xml' }],
  },
  view: () => (
    <>
      <header class="site-header">
        <a class="brand" href="./">
          learn-view
        </a>
        <nav aria-label="Main navigation">
          <a href="./todo/">Todo</a>
          <a href="./data/">Fetch data</a>
          <a href="./about/">About</a>
        </nav>
      </header>
      <main>
        <section class="hero">
          <p class="eyebrow">ketjs-view static starter</p>
          <h1>
            Ship plain HTML.
            <br />
            Add JavaScript only where it earns its place.
          </h1>
          <p class="lede">The page stays marker-free. The counter below is an explicit island.</p>
          {island('counter', counter, { initial: 0 })}
        </section>
      </main>
    </>
  ),
})
