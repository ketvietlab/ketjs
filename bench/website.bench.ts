import { performance } from 'node:perf_hooks'
import { callFn, compose, createTheme, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import { paperTheme, website, websiteForm, websiteMenu, websiteSeo } from 'ketsuite'

const siteCount = Number(process.env.KET_BENCH_SITES ?? 8)
const entriesPerSite = Number(process.env.KET_BENCH_ENTRIES ?? 50)
const revisionPasses = Number(process.env.KET_BENCH_REVISIONS ?? 3)
const renderPasses = Number(process.env.KET_BENCH_RENDERS ?? 2_000)
if (!Number.isInteger(siteCount) || siteCount < 2) throw new Error('KET_BENCH_SITES must be >= 2')
if (!Number.isInteger(entriesPerSite) || entriesPerSite < 1) throw new Error('KET_BENCH_ENTRIES must be >= 1')
if (!Number.isInteger(revisionPasses) || revisionPasses < 1)
  throw new Error('KET_BENCH_REVISIONS must be >= 1')
if (!Number.isInteger(renderPasses) || renderPasses < 1) throw new Error('KET_BENCH_RENDERS must be >= 1')

const modules = [website, websiteMenu, websiteSeo, websiteForm, paperTheme]
const composeStarted = performance.now()
const manifest = compose(modules)
const composeMs = performance.now() - composeStarted
registerFunctions(modules)
const adapter = sqliteAdapter()
await adapter.open()

const scope = { company: 'website-benchmark', branches: null }
const call = async (name: string, input: Record<string, unknown>) => {
  const result = await callFn(name, input, { adapter, manifest, scope })
  if ((result.value as { ok?: boolean } | null)?.ok === false)
    throw new Error(`${name}: ${JSON.stringify((result.value as { errors?: unknown }).errors)}`)
  return result.value
}
const layout = [
  { type: 'website.hero', settings: { heading: 'Benchmark', subheading: 'Schema-backed content' } },
  { type: 'website.rich_text', settings: { heading: 'Body', body: 'Content remains data.' } },
]

try {
  const migrationStarted = performance.now()
  await migrateOne(adapter, manifest)
  const migrationMs = performance.now() - migrationStarted

  const writeStarted = performance.now()
  for (let site = 0; site < siteCount; site += 1) {
    const siteId = `site:${site}`
    await call('website.saveSite', {
      id: siteId,
      name: `Site ${site}`,
      title: `Benchmark site ${site}`,
      defaultLocale: site % 2 ? 'en' : 'vi',
      theme: 'theme_paper',
    })
    await call('website.saveDomain', {
      id: `domain:${site}`,
      siteId,
      host: `site-${site}.example.test`,
      primary: true,
    })
    for (let entry = 0; entry < entriesPerSite; entry += 1)
      await call('website.saveEntry', {
        id: `entry:${site}:${entry}`,
        siteId,
        type: 'website.page',
        slug: `page-${entry}`,
        path: `/page-${entry}`,
        title: `Page ${entry}`,
        layout,
        fields: {},
      })
  }
  const writeMs = performance.now() - writeStarted

  const revisionStarted = performance.now()
  for (let pass = 0; pass < revisionPasses; pass += 1)
    for (let site = 0; site < siteCount; site += 1)
      await call('website.saveEntry', {
        id: `entry:${site}:0`,
        siteId: `site:${site}`,
        type: 'website.page',
        slug: 'page-0',
        path: '/page-0',
        title: `Page 0 revision ${pass + 2}`,
        layout,
        fields: {},
      })
  const revisionMs = performance.now() - revisionStarted

  const readStarted = performance.now()
  const reads = await Promise.all(
    Array.from({ length: siteCount }, (_, site) =>
      call('website.listEntries', { siteId: `site:${site}`, limit: entriesPerSite }),
    ),
  )
  const readMs = performance.now() - readStarted
  const rows = reads.reduce<number>((total, result) => total + (result as unknown[]).length, 0)

  const runtime = createTheme(manifest, modules, { theme: 'theme_paper' })
  const renderStarted = performance.now()
  for (let pass = 0; pass < renderPasses; pass += 1)
    runtime.renderRegion('website.page', { page: { path: '/benchmark' }, sections: layout })
  const renderMs = performance.now() - renderStarted

  const totalEntries = siteCount * entriesPerSite
  console.log(`website sites=${siteCount} entries=${totalEntries} revisions=${siteCount * revisionPasses}`)
  console.log(`compose             : ${composeMs.toFixed(2)} ms`)
  console.log(`migrate             : ${migrationMs.toFixed(2)} ms`)
  console.log(
    `write ${totalEntries} entries  : ${writeMs.toFixed(2)} ms (${(writeMs / totalEntries).toFixed(3)} ms/op)`,
  )
  console.log(
    `revision writes     : ${revisionMs.toFixed(2)} ms (${(revisionMs / (siteCount * revisionPasses)).toFixed(3)} ms/op)`,
  )
  console.log(`parallel site lists : ${readMs.toFixed(2)} ms (${rows} rows)`)
  console.log(
    `KTL renders         : ${renderMs.toFixed(2)} ms (${(renderMs / renderPasses).toFixed(3)} ms/op)`,
  )
} finally {
  await adapter.close()
}
