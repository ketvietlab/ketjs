import { defineDeployment, json, withHeaders } from '@ketvietlab/ketjs'
import { readBody } from './body.ts'
import learn_api from './modules/learn_api.ts'

export const deployment = defineDeployment({
  name: 'learn_api',
  modules: [learn_api],
  headless: true,
  worker: { queues: { learning: 1 } },
  serve: {
    routes: (ctx) => ({
      '/': () => json({ app: 'learn_api', routes: ['/api/todos', '/api/todos/{id}'] }),
      '/api/todos': async (url, req) => {
        if (req.method === 'GET') return json(await ctx.call('learn_api.list', {}, url, req))
        if (req.method !== 'POST')
          return withHeaders(json({ error: 'Method not allowed' }, { status: 405 }), { Allow: 'GET, POST' })
        let input: Record<string, unknown>
        try {
          input = await readBody(req)
        } catch {
          return json({ error: 'Expected a JSON object under 4 KiB' }, { status: 400 })
        }
        return json(await ctx.call('learn_api.create', input, url, req), { status: 201 })
      },
      '/api/todos/{id}': async (url, req, params) => {
        if (req.method !== 'PATCH')
          return withHeaders(json({ error: 'Method not allowed' }, { status: 405 }), { Allow: 'PATCH' })
        let input: Record<string, unknown>
        try {
          input = await readBody(req)
        } catch {
          return json({ error: 'Expected a JSON object under 4 KiB' }, { status: 400 })
        }
        const result = await ctx.call('learn_api.complete', { ...input, id: params.id }, url, req)
        return result === null ? json({ error: 'Todo not found' }, { status: 404 }) : json(result)
      },
    }),
  },
})
export const deployments = [deployment]
