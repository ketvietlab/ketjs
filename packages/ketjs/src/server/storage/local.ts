import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { Dirent } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { storageKey } from './types.ts'
import type { Storage, Stored } from './types.ts'

type LocalMeta = { type: string; etag?: string }

export function localStorage(options: { dir: string }): Storage {
  const root = resolve(options.dir)
  const pathOf = (key: string): string => {
    const path = resolve(root, storageKey(key))
    if (!path.startsWith(root + sep)) throw new Error(`storage key escapes root: ${key}`)
    return path
  }
  const metaPath = (path: string) => `${path}.ketmeta`

  /**
   * A crash between open() and rename() strands a temp file that list() hides, so
   * the sweep can never reach it. Each write clears the stale ones beside it.
   */
  const reapTemps = async (dir: string): Promise<void> => {
    const cutoff = Date.now() - 60 * 60 * 1_000
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.includes('.ket-tmp-')) continue
      const stale = resolve(dir, entry.name)
      try {
        if ((await stat(stale)).mtimeMs < cutoff) await rm(stale, { force: true })
      } catch {}
    }
  }

  const head = async (key: string): Promise<Stored | null> => {
    const path = pathOf(key)
    try {
      const info = await stat(path)
      // A directory satisfies stat() but is not an object. Without this a key naming
      // a shard reports a plausible size and get() then hands back an EISDIR stream
      // after the response headers have already gone out.
      if (!info.isFile()) return null
      let meta: LocalMeta = { type: 'application/octet-stream' }
      try {
        meta = JSON.parse(await readFile(metaPath(path), 'utf8')) as LocalMeta
      } catch {}
      return {
        key,
        size: info.size,
        type: meta.type,
        ...(meta.etag ? { etag: meta.etag } : {}),
        modifiedAt: info.mtime.toISOString(),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  return {
    name: 'local',
    async put(key, body, options) {
      const path = pathOf(key)
      await mkdir(dirname(path), { recursive: true })
      await reapTemps(dirname(path))
      const temp = `${path}.ket-tmp-${randomUUID()}`
      const handle = await open(temp, 'wx')
      const hash = createHash('sha256')
      let size = 0
      try {
        for await (const chunk of body) {
          size += chunk.byteLength
          hash.update(chunk)
          let offset = 0
          while (offset < chunk.byteLength) offset += (await handle.write(chunk, offset)).bytesWritten
        }
        await handle.sync()
      } catch (error) {
        await handle.close().catch(() => {})
        await rm(temp, { force: true })
        throw error
      }
      await handle.close()
      if (options.size !== undefined && size !== options.size) {
        await rm(temp, { force: true })
        throw new Error(`storage body size ${size} does not match declared size ${options.size}`)
      }
      const etag = hash.digest('hex')
      await rename(temp, path)
      const metaTemp = `${metaPath(path)}.ket-tmp-${randomUUID()}`
      await writeFile(metaTemp, JSON.stringify({ type: options.type, etag }))
      await rename(metaTemp, metaPath(path))
      return (await head(key)) as Stored
    },
    async get(key) {
      const meta = await head(key)
      if (!meta) return null
      return { body: createReadStream(pathOf(key)) as AsyncIterable<Uint8Array>, meta }
    },
    head,
    async remove(key) {
      const path = pathOf(key)
      await Promise.all([rm(path, { force: true }), rm(metaPath(path), { force: true })])
    },
    async list(prefix, options = {}) {
      if (prefix) storageKey(prefix.endsWith('/') ? `${prefix}x` : prefix)
      const keys: string[] = []
      const limit = Math.max(1, Math.min(1_000, options.limit ?? 100))
      // Visit in key order — a directory sorts as "name/", which is the prefix every
      // key beneath it carries — so results come out sorted and the walk stops once
      // the page plus one look-ahead is full. Sorting on arrival instead made a
      // paginated sweep re-read the whole tree for every page.
      const ordered = (entries: Dirent[]) =>
        entries
          .map((entry) => ({ entry, at: entry.isDirectory() ? `${entry.name}/` : entry.name }))
          .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
      const walk = async (dir: string): Promise<void> => {
        let entries: Dirent[]
        try {
          entries = await readdir(dir, { withFileTypes: true })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
          throw error
        }
        for (const { entry } of ordered(entries)) {
          if (keys.length > limit) return
          const path = resolve(dir, entry.name)
          if (entry.isDirectory()) await walk(path)
          else if (!entry.name.endsWith('.ketmeta') && !entry.name.includes('.ket-tmp-')) {
            const key = relative(root, path).split(sep).join('/')
            if (!key.startsWith(prefix) || (options.after && key <= options.after)) continue
            keys.push(key)
          }
        }
      }
      const slash = prefix.lastIndexOf('/')
      const directory = slash >= 0 ? prefix.slice(0, slash) : ''
      await walk(directory ? pathOf(directory) : root)
      const page = keys.slice(0, limit)
      return {
        keys: page,
        ...(keys.length > limit ? { next: page[page.length - 1] as string } : {}),
      }
    },
    async signedUrl() {
      return null
    },
  }
}
