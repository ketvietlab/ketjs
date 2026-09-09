import { existsSync, statSync, watch } from 'node:fs'
import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { buildProject, loadConfig, readProjectFile } from './project.ts'

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const send = (response: ServerResponse, status: number, body: string): void => {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(body)
}

const fileFor = (outDir: string, requestPath: string): string | null => {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  const candidate = resolve(outDir, `.${normalize(decoded)}`)
  const child = relative(outDir, candidate)
  if (child === '..' || child.startsWith(`..${sep}`)) return null
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  const index = join(candidate, 'index.html')
  return existsSync(index) && statSync(index).isFile() ? index : null
}

export async function serveProject(
  root = process.cwd(),
  options: { dev?: boolean; host?: string; port?: number } = {},
): Promise<{ url: string; close(): Promise<void> }> {
  const config = await loadConfig(root)
  const dev = options.dev ?? false
  if (dev) await buildProject(root, { reload: true })
  else if (!existsSync(config.outDir))
    throw new Error(`output directory does not exist: ${config.outDir}; run ket-view build first`)

  const clients = new Set<ServerResponse>()
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (dev && url.pathname === '/__ket_view_events') {
      response.writeHead(200, {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
      })
      response.write(': connected\n\n')
      clients.add(response)
      request.on('close', () => clients.delete(response))
      return
    }
    const file = fileFor(config.outDir, url.pathname)
    if (!file) return send(response, 404, 'Not found')
    response.writeHead(200, {
      'cache-control': dev ? 'no-store' : 'public, max-age=0',
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    })
    response.end(readProjectFile(file))
  })

  const host = options.host ?? config.host
  const port = options.port ?? (dev ? config.port : 4173)
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolveListen()
    })
  })

  let watcher: ReturnType<typeof watch> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let building = false
  let queued = false
  const rebuild = async (): Promise<void> => {
    if (building) {
      queued = true
      return
    }
    building = true
    try {
      await buildProject(root, { reload: true })
      for (const client of clients) client.write('data: reload\n\n')
      console.log('rebuilt static site')
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
    } finally {
      building = false
      if (queued) {
        queued = false
        void rebuild()
      }
    }
  }
  if (dev) {
    const out = relative(config.root, config.outDir)
    watcher = watch(config.root, { recursive: true }, (_event, filename) => {
      const path = String(filename ?? '')
      const parts = path.split(/[\\/]/)
      if (
        !path ||
        path === out ||
        path.startsWith(`${out}${sep}`) ||
        path.startsWith(`${out}.ket-view-backup-`) ||
        parts.includes('.git') ||
        parts.includes('node_modules') ||
        parts.some((part) => part.startsWith('.ket-view-stage-'))
      )
        return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void rebuild(), 80)
    })
  }

  const url = `http://${host}:${port}`
  return {
    url,
    close: async () => {
      if (timer) clearTimeout(timer)
      watcher?.close()
      for (const client of clients) client.end()
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      )
    },
  }
}
