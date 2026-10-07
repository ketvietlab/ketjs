import { definePage, island } from '@ketvietlab/ketjs-view-tools'
import todo from '../islands/todo.tsx'
export default definePage({
  head: {
    title: 'Todo lab | learn-view',
    description: 'Add and complete tasks with signals and keyed lists.',
    lang: 'en',
  },
  view: () => (
    <>
      <header class="site-header">
        <a href="/">learn-view</a>
        <nav>
          <a href="/todo/">Todo</a>
          <a href="/about/">About</a>
        </nav>
      </header>
      <main>{island('todo', todo, {}, { key: [] })}</main>
    </>
  ),
})
