import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const prefix = '/_ket/dev/islands/'

export function devIslandAssets(env: NodeJS.ProcessEnv): string | undefined {
  if (env.KET_DEV === '1' && env.KET_DEV_SOURCE === '1') return env.KET_DEV_ISLAND_DIR
}

export async function serveDevIslandAsset(
  directory: string,
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!path.startsWith(prefix)) return false
  const file = path.slice(prefix.length)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end()
    return true
  }
  const manifest = file === 'manifest.json'
  if (!manifest && !/^[a-f0-9]{64}\.mjs$/u.test(file)) {
    res.writeHead(404).end()
    return true
  }
  const body = await readFile(join(directory, file)).catch(() => undefined)
  if (!body) {
    res.writeHead(404).end()
    return true
  }
  res.writeHead(200, {
    'cache-control': manifest ? 'no-store' : 'private, max-age=31536000, immutable',
    'content-type': manifest ? 'application/json' : 'text/javascript; charset=utf-8',
  })
  res.end(req.method === 'HEAD' ? undefined : body)
  return true
}

export const devIslandClient = `
let devRuntime
const refreshDevIslands = async (manager) => {
  const response = await fetch('${prefix}manifest.json', { cache: 'no-store' })
  if (!response.ok) return
  const { runtime, islands: versions } = await response.json()
  if (devRuntime && devRuntime !== runtime) {
    location.reload()
    return
  }
  devRuntime = runtime
  for (const [name, hash] of Object.entries(versions)) {
    if (!Object.hasOwn(definitions, name)) continue
    const definition = definitions[name]
    const src = '${prefix}' + hash + '.mjs'
    if (definition.src === src) continue
    if (!manager || (!registry[name] && !loading.has(name))) {
      definition.src = src
      continue
    }
    // Finish any original hydration import before replacing its registry entry.
    await loading.get(name)
    const factory = (await import(src))[definition.export]
    if (typeof factory !== 'function') throw new TypeError('Invalid developer island export: ' + name)
    registry[name] = factory
    definition.src = src
    const placed = [...document.querySelectorAll(ISLAND_SELECTOR)].filter(
      (element) => element.getAttribute('data-island') === name,
    )
    for (const host of placed) {
      if (!host.isConnected) continue
      manager.dispose(host)
      host.replaceChildren()
      manager.mount(host)
    }
  }
}
const watchDevIslands = async () => {
  try {
    await refreshDevIslands(islands)
  } catch (error) {
    console.error('Could not refresh a developer island', error)
  } finally {
    setTimeout(watchDevIslands, 250)
  }
}
`
