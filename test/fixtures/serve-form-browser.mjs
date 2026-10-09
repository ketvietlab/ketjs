// Run after the framework build; this serves a browser contract fixture, not a deployment.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtures = dirname(fileURLToPath(import.meta.url))
const root = resolve(fixtures, '../../packages/ketjs-view/dist')
const routes = new Map([
  ['/', resolve(fixtures, 'form-browser.html')],
  ['/regressions/', resolve(fixtures, 'form-dom-regressions.html')],
  ['/form-trace.mjs', resolve(fixtures, '../../bench/form-comparison/trace.mjs')],
])
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path === '/favicon.ico') return res.writeHead(204).end()
    const file = routes.get(path) ?? resolve(root, path.slice('/view/'.length))
    if (!routes.has(path) && (!path.startsWith('/view/') || !file.startsWith(`${root}/`)))
      return res.writeHead(404).end()
    res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : 'text/javascript')
    res.end(await readFile(file))
  } catch {
    res.writeHead(404).end()
  }
})
server.listen(Number(process.env.FORM_TEST_PORT ?? 39751), '127.0.0.1', () => {
  console.log('Form fixture listening', server.address())
})
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
