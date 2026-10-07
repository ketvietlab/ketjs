import { defineConfig } from '@ketvietlab/ketjs-view-tools'

export default defineConfig({
  pages: 'src/pages',
  styles: ['src/styles/main.css'],
  islands: {
    'task-search': 'src/islands/task-search.tsx',
    counter: 'src/islands/counter.tsx',
    todo: 'src/islands/todo.tsx',
    validation: 'src/islands/validation.tsx',
  },
  base: '/',
})
