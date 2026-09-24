import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, resolve, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const viewRoot = dirname(fileURLToPath(import.meta.resolve('@ketvietlab/ketjs-view')))
// Built by the root `npm run build`; the demo is repository-only, so it reads the sibling package directly.
const tokenFile = fileURLToPath(new URL('../../design-system/dist/foundations/tokens.css', import.meta.url))
const port = Number(process.env.PORT ?? 4190)
const types = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1')
    const pathname = decodeURIComponent(url.pathname)
    if (pathname === '/live-doc.mjs') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' })
      response.end(await readFile(resolve(root, 'demo/vendor/live-doc.mjs')))
      return
    }
    if (pathname === '/ketjs-i18n.mjs') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      response.end(await readFile(resolve(root, 'demo/vendor/ketjs-i18n.mjs')))
      return
    }
    if (pathname === '/design-system/tokens.css') {
      response.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      response.end(await readFile(tokenFile))
      return
    }
    const base = pathname.startsWith('/view/') ? viewRoot : root
    const relative = pathname.startsWith('/view/')
      ? pathname.slice(6)
      : pathname === '/'
        ? 'demo/index.html'
        : pathname.slice(1)
    // Only demo assets and the public browser runtime are exposed, never the repo.
    if (base === root && !/^(demo|src)\//.test(relative)) throw new Error('Not found')
    const path = resolve(base, relative)
    if (!path.startsWith(resolve(base) + sep)) throw new Error('Not found')
    const body = await readFile(path)
    response.writeHead(200, {
      'Content-Type': `${types[extname(path)] ?? 'application/octet-stream'}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end('Not found')
  }
})
server.listen(port, '127.0.0.1', () => console.log(`Flow UI demo: http://127.0.0.1:${port}`))
process.on('SIGTERM', () => server.close())
process.on('SIGINT', () => server.close())
