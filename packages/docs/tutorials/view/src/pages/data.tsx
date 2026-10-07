import { definePage, island } from '@ketvietlab/ketjs-view-tools'
import taskSearch from '../islands/task-search.tsx'

export default definePage({
  head: {
    title: 'Fetch data with an island',
    description: 'A cancellable, reactive data loading example.',
    lang: 'en',
  },
  view: () => (
    <main>
      <a href="/">← Home</a>
      {island('task-search', taskSearch, { endpoint: '/data/todos.json' })}
    </main>
  ),
})
