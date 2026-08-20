// S3-compatible storage through real HTTP, while attachment metadata is written
// into separate physical tenant databases. This exercises the tenant pool,
// module route, multipart parser and namespace path used by a deployment.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootApp, defineApp, s3Storage, sha256, signRequest, sqliteAdapter } from 'ketjs'
import { postgresAdapter } from 'ketjs-postgres'
import type { Adapter, BootedApp } from 'ketjs'
import { company, partner, storage as storageModule } from 'ketsuite'
import { address } from 'ketsuite'

const driver = process.env.KET_BENCH_DRIVER ?? 'sqlite'
const tenantCount = Number(process.env.KET_BENCH_DATABASES ?? (driver === 'postgres' ? 4 : 8))
const filesPerTenant = Number(process.env.KET_BENCH_FILES ?? 25)
const endpoint = process.env.KET_TEST_S3_ENDPOINT ?? 'http://127.0.0.1:19000'
const bucket = process.env.KET_TEST_S3_BUCKET ?? 'ketjs-storage-bench'
const credentials = {
  accessKeyId: process.env.KET_TEST_S3_KEY ?? 'ketjsminio',
  secretAccessKey: process.env.KET_TEST_S3_SECRET ?? 'ketjsminiosecret',
  region: process.env.KET_TEST_S3_REGION ?? 'us-east-1',
  service: 's3',
}
if (!Number.isInteger(tenantCount) || tenantCount < 2) throw new Error('KET_BENCH_DATABASES must be >= 2')
if (!Number.isInteger(filesPerTenant) || filesPerTenant < 1) throw new Error('KET_BENCH_FILES must be >= 1')

const tenants = Array.from({ length: tenantCount }, (_, i) => `storage_bench_${String(i).padStart(3, '0')}`)
const pgUrl = process.env.KET_BENCH_PG ?? 'postgres://dev:devpassword@127.0.0.1:5435/postgres'
const pgBase = pgUrl.replace(/\/[^/]*$/, '')
let localDir: string | null = null
let admin: Adapter | null = null
let server: BootedApp | null = null
const root = s3Storage({ endpoint, bucket, pathStyle: true, ...credentials })

const open = (key: string): Adapter =>
  driver === 'postgres'
    ? postgresAdapter(`${pgBase}/${key}`, { max: 2 })
    : sqliteAdapter(join(localDir as string, `${key}.db`))

const prepare = async () => {
  const url = new URL(`/${bucket}`, endpoint)
  const headers = signRequest({ method: 'PUT', url, payloadHash: sha256(''), credentials })
  const made = await fetch(url, { method: 'PUT', headers })
  if (!made.ok && made.status !== 409) throw new Error(`cannot create benchmark bucket: ${await made.text()}`)
  if (driver === 'sqlite') {
    localDir = mkdtempSync(join(tmpdir(), 'ket-storage-bench-'))
    return
  }
  if (driver !== 'postgres') throw new Error('KET_BENCH_DRIVER must be sqlite or postgres')
  admin = postgresAdapter(pgUrl, { max: 1 })
  await admin.open()
  for (const key of tenants) {
    await admin.exec(`DROP DATABASE IF EXISTS "${key}" WITH (FORCE)`)
    await admin.exec(`CREATE DATABASE "${key}"`)
  }
}

const cleanup = async () => {
  await server?.close().catch(() => {})
  for (const tenant of tenants) {
    try {
      let after: string | undefined
      do {
        const page = await root.list(`${tenant}/`, { ...(after ? { after } : {}), limit: 1_000 })
        await Promise.all(page.keys.map((key) => root.remove(key)))
        after = page.next
      } while (after)
    } catch {}
  }
  if (admin) {
    for (const key of tenants) await admin.exec(`DROP DATABASE IF EXISTS "${key}" WITH (FORCE)`)
    await admin.close()
  }
  if (localDir) rmSync(localDir, { recursive: true, force: true })
}

try {
  await prepare()
  const app = defineApp({
    name: 'storage_benchmark',
    modules: [address, partner, company, storageModule],
    headless: true,
    serve: {
      bootstrap: ['storage'],
      tenants: {
        resolve: (_url, req) => {
          const key = String(req.headers['x-tenant'] ?? '')
          return tenants.includes(key) ? key : null
        },
        open,
        list: async () => tenants,
        max: Math.min(tenantCount, 8),
      },
    },
  })
  server = await bootApp(app, {
    port: 0,
    env: {
      KET_STORAGE: 's3',
      KET_S3_ENDPOINT: endpoint,
      KET_S3_REGION: credentials.region,
      KET_S3_BUCKET: bucket,
      KET_S3_KEY: credentials.accessKeyId,
      KET_S3_SECRET: credentials.secretAccessKey,
      KET_S3_PATH_STYLE: '1',
      KET_COMPANY: 'acme',
    },
  })
  const at = `http://127.0.0.1:${server.port}`
  const started = performance.now()
  const uploaded = await Promise.all(
    tenants.flatMap((tenant) =>
      Array.from({ length: filesPerTenant }, async (_, n) => {
        const form = new FormData()
        form.set('resModel', 'bench.Record')
        form.set('resId', String(n))
        form.set('file', new File([`tenant=${tenant}; file=${n}`], `${n}.txt`, { type: 'text/plain' }))
        const response = await fetch(`${at}/files`, {
          method: 'POST',
          headers: { 'x-tenant': tenant },
          body: form,
        })
        if (response.status !== 201)
          throw new Error(`${tenant}/${n}: ${response.status} ${await response.text()}`)
        return { tenant, row: (await response.json()) as { id: string; storeKey: string } }
      }),
    ),
  )
  const uploadMs = performance.now() - started

  const readStarted = performance.now()
  await Promise.all(
    uploaded.map(async ({ tenant, row }) => {
      const response = await fetch(`${at}/files/${row.id}`, { headers: { 'x-tenant': tenant } })
      if (response.status !== 200) throw new Error(`${tenant}/${row.id}: download ${response.status}`)
      await response.arrayBuffer()
    }),
  )
  const readMs = performance.now() - readStarted
  await server.close()
  server = null

  for (const tenant of tenants) {
    const page = await root.list(`${tenant}/blobs/acme/`)
    if (page.keys.length !== filesPerTenant)
      throw new Error(`${tenant} has ${page.keys.length}/${filesPerTenant} isolated objects`)
    await Promise.all(page.keys.map((key) => root.remove(key)))
  }
  const total = tenantCount * filesPerTenant
  console.log(
    JSON.stringify(
      {
        driver,
        storage: 'MinIO (S3 API)',
        databases: tenantCount,
        files: total,
        uploadMs: Number(uploadMs.toFixed(1)),
        uploadsPerSecond: Math.round((total * 1_000) / uploadMs),
        downloadMs: Number(readMs.toFixed(1)),
        downloadsPerSecond: Math.round((total * 1_000) / readMs),
        tenantNamespacesComplete: true,
      },
      null,
      2,
    ),
  )
} finally {
  await cleanup()
}
