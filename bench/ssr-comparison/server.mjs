// Loopback HTTP/1.1, a common query/adapter, and persistent connections on one machine.
import assert from 'node:assert/strict'
import { createServer, request, Agent } from 'node:http'
import express from 'express'
import Fastify from 'fastify'
import { compose, createKetServer, defineModule, json } from '@ketvietlab/ketjs'
import { frameworkVersion, openDatabase, sqlFor } from './database.mjs'

const manifest = compose([defineModule({ name: 'server_bench' })], { headless: true })
const concurrency = 16,
  requests = 1600,
  warmup = 160
const rotation = Number(process.argv[2] ?? 0) % 4
const frameworks = ['KetJS', 'Node HTTP baseline', 'Express', 'Fastify']
for (const engine of ['SQLite', 'PostgreSQL'])
  for (let index = 0; index < frameworks.length; index++) {
    const framework = frameworks[(index + rotation) % frameworks.length]
    const database = await openDatabase(engine, true)
    const sql = sqlFor(engine)
    /** @type {Record<string, () => Promise<unknown>>} */
    const handlers = {
      '/json': async () => ({ ok: true }),
      '/db/point': async () => (await database.adapter.all(sql.point, [1234]))[0],
      '/db/range': async () => Array.from(await database.adapter.all(sql.range, [3, 100])),
    }
    /** @type {import('node:http').Server | undefined} */
    let server
    /** @type {(() => Promise<unknown>) | undefined} */
    let close
    const agent = new Agent({ keepAlive: true, maxSockets: concurrency })
    try {
      if (framework === 'KetJS') {
        const app = await createKetServer({
          manifest,
          // openDatabase(engine, true) opened a KetJS adapter.
          adapter: /** @type {import('@ketvietlab/ketjs').Adapter} */ (database.adapter),
          queueNotify: false,
          routes: Object.fromEntries(
            Object.entries(handlers).map(([path, handler]) => [path, async () => json(await handler())]),
          ),
        })
        server = app.server
        close = () => app.close()
      } else if (framework === 'Express') {
        const app = express()
        app.disable('etag')
        app.disable('x-powered-by')
        for (const [path, handler] of Object.entries(handlers))
          app.get(path, async (_req, res) => res.json(await handler()))
        const http = createServer(app)
        server = http
        close = () => new Promise((resolve) => http.close(resolve))
      } else if (framework === 'Fastify') {
        const app = Fastify({ logger: false })
        for (const [path, handler] of Object.entries(handlers)) app.get(path, handler)
        await app.ready()
        server = app.server
        close = () => app.close()
      } else {
        const http = createServer(async (req, res) => {
          try {
            const handler = handlers[req.url ?? '']
            if (!handler) {
              res.writeHead(404)
              res.end()
              return
            }
            const body = JSON.stringify(await handler())
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(body)
          } catch {
            res.writeHead(500)
            res.end()
          }
        })
        server = http
        close = () => new Promise((resolve) => http.close(resolve))
      }
      const listening = server
      await new Promise((resolve, reject) => {
        listening.once('error', reject)
        listening.listen(0, '127.0.0.1', () => resolve(undefined))
      })
      const address = listening.address()
      assert.ok(address && typeof address === 'object', 'the server listens on a TCP port')
      const port = address.port
      /**
       * @param {string} path
       * @returns {Promise<any>} the parsed JSON body
       */
      const get = (path) =>
        new Promise((resolve, reject) => {
          const req = request({ host: '127.0.0.1', port, path, agent }, (response) => {
            /** @type {Buffer[]} */
            const chunks = []
            response.on('data', (chunk) => chunks.push(chunk))
            response.on('error', reject)
            response.on('end', () => {
              try {
                assert.equal(response.statusCode, 200)
                resolve(JSON.parse(Buffer.concat(chunks).toString()))
              } catch (error) {
                reject(error)
              }
            })
          })
          req.on('error', reject)
          req.end()
        })
      /**
       * @param {string} path
       * @param {number} total
       * @param {boolean} measured
       */
      const load = async (path, total, measured) => {
        /** @type {number[]} */
        const latencies = []
        let completed = 0
        await Promise.all(
          Array.from({ length: concurrency }, async () => {
            for (let i = 0; i < total / concurrency; i++) {
              const start = performance.now()
              const result = await get(path)
              if (path === '/json') assert.equal(result.ok, true)
              else if (path === '/db/point') assert.equal(result.id, 1234)
              else {
                assert.equal(result.length, 20)
                assert.equal(result[0].id, 103)
              }
              if (measured) latencies.push(performance.now() - start)
              completed++
            }
          }),
        )
        assert.equal(completed, total)
        return latencies.sort((a, b) => a - b)
      }
      for (const path of Object.keys(handlers)) {
        await load(path, warmup, false)
        const start = performance.now()
        const latencies = await load(path, requests, true)
        const milliseconds = performance.now() - start
        console.log(
          JSON.stringify({
            framework,
            version:
              framework === 'KetJS'
                ? frameworkVersion
                : framework === 'Express'
                  ? '5.2.1'
                  : framework === 'Fastify'
                    ? '5.12.5'
                    : process.version,
            engine,
            databaseVersion: database.version,
            path,
            concurrency,
            requests,
            warmup,
            milliseconds,
            perSecond: (requests * 1000) / milliseconds,
            medianLatencyMs: latencies[Math.floor(latencies.length / 2)],
            p95LatencyMs: latencies[Math.ceil(latencies.length * 0.95) - 1],
            errors: 0,
          }),
        )
      }
    } finally {
      agent.destroy()
      if (close) await close()
      await database.close()
    }
  }
