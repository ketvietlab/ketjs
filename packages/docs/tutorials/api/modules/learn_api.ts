import { randomUUID } from 'node:crypto'
import { defineModule, defineJob, from, eq, asc } from '@ketvietlab/ketjs'

export default defineModule({
  name: 'learn_api',
  title: 'Todo lab',
  models: { Todo: { scope: 'company', fields: { id: 'id', title: 'text', done: 'bool' } } },
  jobs: {
    finishTodo: defineJob({
      input: { id: 'id' },
      queue: 'learning',
      idempotent: true,
      effects: ['write:learn_api.Todo'],
      handler: async (ctx, input) => {
        await ctx.db.update('learn_api.Todo', { id: input.id }, { done: true })
      },
    }),
  },
  functions: {
    scheduleCompletion: {
      input: { id: 'id' },
      effects: ['read:learn_api.Todo', 'write:learn_api.Todo', 'enqueue:learn_api.finishTodo'],
      handler: (ctx, input) =>
        ctx.tx(async (tx) => {
          const Todo = tx.table('learn_api.Todo')
          const current = await tx.db.one(from(Todo).where(eq(Todo.id, String(input.id))))
          if (!current) return null
          await tx.db.update('learn_api.Todo', { id: input.id }, { done: false })
          return tx.jobs.enqueue(
            'learn_api.finishTodo',
            { id: input.id },
            { uniqueKey: `finish:${input.id}` },
          )
        }),
    },
    list: {
      agent: true,
      effects: ['read:learn_api.Todo'],
      handler: (ctx) => {
        const Todo = ctx.table('learn_api.Todo')
        return ctx.db.all(from(Todo).select(Todo.id, Todo.title, Todo.done).orderBy(asc(Todo.title)))
      },
    },
    create: {
      input: { title: 'text' },
      effects: ['write:learn_api.Todo'],
      handler: async (ctx, input) => {
        const changes = ctx
          .change('learn_api.Todo', { title: String(input.title).trim() })
          .cast(['title'])
          .required(['title'])
          .validate('title', (value) => String(value).length <= 120 || 'Use 120 characters or fewer')
          .put('id', randomUUID())
          .put('done', false)
        await ctx.db.commit(changes)
        return changes.changes
      },
    },
    complete: {
      input: { id: 'id', done: 'bool' },
      effects: ['read:learn_api.Todo', 'write:learn_api.Todo'],
      handler: async (ctx, input) => {
        const Todo = ctx.table('learn_api.Todo')
        const current = await ctx.db.one(from(Todo).where(eq(Todo.id, String(input.id))))
        if (!current) return null
        const changes = ctx.change('learn_api.Todo', input, current).cast(['done'])
        await ctx.db.commit(changes, { id: current.id })
        return { id: current.id, title: current.title, done: changes.changes.done }
      },
    },
  },
  messages: { en: { 'app.title': 'Todo lab', 'page.notFound': 'Page not found' } },
})
