// Static assets a browser may keep.
//
// Every asset used to be served from its own name with `cache-control:
// no-cache`, and no `ETag` or `Last-Modified` beside it. That pair is the worst
// of both: `no-cache` tells a cache it must revalidate before reusing anything,
// and with nothing to revalidate *against* the revalidation cannot answer 304 —
// so every page load re-fetched every stylesheet and every island bundle in
// full, and a CDN in front of it had nothing it was allowed to do.
//
// A file's own content is the only honest version of it, so that is what goes
// in the URL. A build that changes nothing changes no URL; a build that changes
// one bundle changes one URL, and the rest of a deployment's assets stay in
// caches where they are.

import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Manifest } from '../types.ts'

/** How much of the digest goes in the path. Eight hex is 4 billion; a file is not adversarial. */
const DIGEST = 8

/**
 * The marker that says a path segment is a version rather than a directory.
 *
 * Explicit, because `assetMount` has to strip it back off to find the file on
 * disk, and "the first segment, if it looks like hex" is a rule that breaks the
 * day somebody ships a directory named `deadbeef`.
 */
export const VERSION_PREFIX = 'v'

const versionSegment = /^v[0-9a-f]{8,}$/

/** Splits `v1a2b3c4d/live-doc.mjs` back into the file it names. */
export const withoutVersion = (path: string): string => {
  const slash = path.indexOf('/')
  if (slash <= 0) return path
  return versionSegment.test(path.slice(0, slash)) ? path.slice(slash + 1) : path
}

/** True when this request named a version, and so may be cached forever. */
export const isVersioned = (path: string): boolean =>
  path.split('/').some((segment) => versionSegment.test(segment))

const walk = async (dir: string, base = dir): Promise<string[]> => {
  const found: string[] = []
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    const info = await stat(full).catch(() => null)
    if (!info) continue
    if (info.isDirectory()) found.push(...(await walk(full, base)))
    else found.push(relative(base, full))
  }
  return found
}

/**
 * Rewrites every asset URL in the manifest to carry its file's digest.
 *
 * Done at boot rather than in `compose`, which is synchronous and runs in tests
 * that have no business reading a disk. A deployment that cannot read one of
 * its own asset directories simply keeps the unversioned URL: the page still
 * works, it just revalidates the way it always did.
 */
export async function fingerprintAssets(manifest: Manifest): Promise<Map<string, string>> {
  const versions = new Map<string, string>()
  await Promise.all(
    Object.entries(manifest.assets).map(async ([owner, dir]) => {
      for (const file of await walk(dir)) {
        const bytes = await readFile(join(dir, file)).catch(() => null)
        if (!bytes) continue
        const digest = createHash('sha256').update(bytes).digest('hex').slice(0, DIGEST)
        versions.set(`${owner}/${file}`, `${VERSION_PREFIX}${digest}`)
      }
    }),
  )

  const versioned = (href: string): string => {
    const prefix = '/_ket/asset/'
    if (!href.startsWith(prefix)) return href
    const rest = href.slice(prefix.length)
    const version = versions.get(rest)
    if (!version) return href
    const slash = rest.indexOf('/')
    return `${prefix}${rest.slice(0, slash)}/${version}/${rest.slice(slash + 1)}`
  }

  for (const style of manifest.styles) style.href = versioned(style.href)
  for (const island of Object.values(manifest.islands)) {
    const client = (island as { client?: { src: string } }).client
    if (client) client.src = versioned(client.src)
  }
  return versions
}
