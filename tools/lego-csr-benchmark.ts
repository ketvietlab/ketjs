import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { cpus, freemem, platform, release, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { tableNameFor, type Adapter } from '@ketvietlab/ketjs'
import { createTestDeployment, type TestDeployment } from '@ketvietlab/ketjs/testing'
import {
  LEGO_EXTENSION_COUNTS,
  LEGO_PARTNER_COUNTS,
  legoDeployment,
  seedLegoFixture,
} from '../bench/lego-csr-fixture.ts'

type PageResponse = { ok(): boolean; status(): number }
type Page = {
  on<T>(event: string, listener: (value: T) => void): void
  goto(input: string, options?: Record<string, unknown>): Promise<PageResponse | null>
  waitForLoadState(state: string): Promise<void>
  waitForSelector(selector: string): Promise<unknown>
  waitForFunction(fn: () => unknown): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  evaluate<T>(fn: () => T): Promise<T>
  screenshot(options: Record<string, unknown>): Promise<unknown>
}
type CDPSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  once(event: string, listener: (payload: { stream?: string }) => void): void
}
type BrowserContext = {
  readonly request: {
    post(input: string, options: { data: Record<string, string> }): Promise<unknown>
  }
  addInitScript(script: () => void): Promise<void>
  newPage(): Promise<Page>
  newCDPSession(page: Page): Promise<CDPSession>
  close(): Promise<void>
}
type Browser = {
  newContext(options: Record<string, unknown>): Promise<BrowserContext>
  close(): Promise<void>
}
type PlaywrightModule = {
  readonly chromium: {
    launch(options: Record<string, unknown>): Promise<Browser>
  }
}

type Mode = 'ssr-current' | 'ssr-matched' | 'csr-two-stage' | 'csr-planned'
type RoleFilter = 'default' | 'customer'
type ViewportName = 'desktop' | 'mobile'
const ALL_MODES: Mode[] = ['ssr-current', 'ssr-matched', 'csr-two-stage', 'csr-planned']
const selected = <T extends string | number>(values: readonly T[], raw: string | undefined): T[] => {
  if (!raw) return [...values]
  const wanted = new Set(raw.split(',').map((value) => value.trim()))
  return values.filter((value) => wanted.has(String(value)))
}
const MODES = selected(ALL_MODES, process.env.LEGO_BENCH_MODES)
const PARTNER_COUNTS = selected(LEGO_PARTNER_COUNTS, process.env.LEGO_BENCH_SIZES)
const EXTENSION_COUNTS = selected(LEGO_EXTENSION_COUNTS, process.env.LEGO_BENCH_EXTENSIONS)
const SAMPLES = Math.max(1, Number(process.env.LEGO_BENCH_SAMPLES ?? 30))
const QUICK = process.env.LEGO_BENCH_QUICK === '1'
const PHASE = process.env.LEGO_BENCH_PHASE ?? 'all'
const root = resolve(process.env.LEGO_ARTIFACT_DIR ?? '.artifacts/lego-csr')
const runId = process.env.LEGO_RUN_ID ?? new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const runDir = join(root, `run-${runId}`)
const rawDir = join(runDir, 'raw')
const evidenceDir = join(runDir, 'browser-evidence')
const databaseDir = join(runDir, 'databases')
const runtimeDir = join(runDir, 'runtime')

type ServerSample = {
  size: number
  extensions: number
  role: RoleFilter
  mode: Mode
  temperature: 'route-first' | 'warm'
  durationMs: number
  bytes: number
  status: number
  dbQueries?: number
  dbMs?: number
  dbRows?: number
  cpuUserMs?: number
  cpuSystemMs?: number
  rssDeltaBytes?: number
}

type BrowserSample = {
  class: 'coverage' | 'principal' | 'sensitivity'
  size: number
  extensions: number
  role: RoleFilter
  mode: Mode
  viewport: ViewportName
  rttMs: number
  temperature: 'cold-cache' | 'warm-cache'
  ttfbMs?: number
  domContentLoadedMs?: number
  loadMs?: number
  coreMs?: number
  requiredMs?: number
  completeMs?: number
  lcpMs?: number
  cls?: number
  transferBytes?: number
  requestCount?: number
  dataRequestCount?: number
  dataWaves?: number
  decodedBytes?: number
  cacheHitCount?: number
  heapBytes?: number
  longTaskCount?: number
  longTaskMs?: number
  hydrateMs?: number
  renderMs?: number
  rows?: number
  columns?: number
  rowStable?: boolean | null
  viewportWidth?: number
  documentWidth?: number
  horizontalOverflowPx?: number
  tableClientWidth?: number
  tableScrollWidth?: number
  tableOverflowPx?: number
  tableResponsive?: string | null
  firstRowHeight?: number
  visibleCells?: number
  shellCount?: number
  listPageCount?: number
  tabsCount?: number
  searchMenuCount?: number
  bulkFormCount?: number
  selectAllCount?: number
  designSystemRoot?: boolean
  retries?: number
  error?: string
}

type LoadSample = ServerSample & { targetRate: number; startedAtMs: number; completedAtMs: number }

type DbProbe = { queries: number; ms: number; rows: number }

const serverSamples: ServerSample[] = []
const browserSamples: BrowserSample[] = []
const loadSamples: LoadSample[] = []
const seeds: Array<Record<string, unknown>> = []
const dbProbes = new WeakMap<TestDeployment, DbProbe>()

const ensure = async (): Promise<void> => {
  for (const path of [root, runDir, rawDir, evidenceDir, databaseDir, runtimeDir])
    await mkdir(path, { recursive: true })
}

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

const csv = (rows: Array<Record<string, unknown>>): string => {
  if (!rows.length) return ''
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const cell = (value: unknown): string => {
    const text = value === undefined || value === null ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return `${columns.join(',')}\n${rows.map((row) => columns.map((column) => cell(row[column])).join(',')).join('\n')}\n`
}

const percentile = (values: number[], ratio: number): number => {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1))] ?? 0
}

const distribution = (values: number[]) => {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length)
  return {
    n: values.length,
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: Math.min(...values),
    max: Math.max(...values),
    mean,
    stddev: Math.sqrt(variance),
    cv: mean === 0 ? 0 : Math.sqrt(variance) / mean,
  }
}

const groupedSummary = <T extends Record<string, unknown>>(
  rows: T[],
  keys: string[],
  metric: keyof T,
): Array<Record<string, unknown>> => {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = JSON.stringify(keys.map((field) => row[field]))
    const held = groups.get(key) ?? []
    held.push(row)
    groups.set(key, held)
  }
  return [...groups.values()].map((held) => ({
    ...Object.fromEntries(keys.map((key) => [key, held[0]![key]])),
    ...distribution(held.map((row) => Number(row[metric])).filter(Number.isFinite)),
  }))
}

const groupedMetricSummary = <T extends Record<string, unknown>>(
  rows: T[],
  keys: string[],
  metrics: Array<keyof T>,
): Array<Record<string, unknown>> => {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = JSON.stringify(keys.map((field) => row[field]))
    const held = groups.get(key) ?? []
    held.push(row)
    groups.set(key, held)
  }
  return [...groups.values()].map((held) => {
    const output: Record<string, unknown> = Object.fromEntries(keys.map((key) => [key, held[0]![key]]))
    for (const metric of metrics) {
      const values = held.map((row) => Number(row[metric])).filter(Number.isFinite)
      if (!values.length) continue
      for (const [name, value] of Object.entries(distribution(values)))
        output[`${String(metric)}${name[0]!.toUpperCase()}${name.slice(1)}`] = value
    }
    return output
  })
}

const git = (...args: string[]): string => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const metadata = () => ({
  runId,
  startedAt: new Date().toISOString(),
  gitCommit: git('rev-parse', 'HEAD'),
  gitBranch: git('branch', '--show-current'),
  gitDirty: Boolean(git('status', '--porcelain')),
  node: process.version,
  platform: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model ?? 'unknown',
  cpuCount: cpus().length,
  memoryBytes: totalmem(),
  freeMemoryAtStartBytes: freemem(),
  adapter: 'sqlite',
  postgresCoverage: 'not run; PostgreSQL performance remains unproven',
  databasePoolSize: 1,
  browserProviderConcurrency: 4,
  emulatedDownMbps: 100,
  emulatedUpMbps: 50,
  samples: SAMPLES,
  quick: QUICK,
  phase: PHASE,
  chrome: existsSync('/usr/bin/google-chrome')
    ? execFileSync('/usr/bin/google-chrome', ['--version'], { encoding: 'utf8' }).trim()
    : 'not found',
})

const databasePath = (size: number): string => join(databaseDir, `partners-${size}.db`)

const instrumentDatabase = (deployment: TestDeployment): void => {
  const adapter = deployment.adapter
  if (!adapter) return
  const probe: DbProbe = { queries: 0, ms: 0, rows: 0 }
  const originalAll = adapter.all.bind(adapter)
  const originalRun = adapter.run.bind(adapter)
  adapter.all = async (sql, params) => {
    const started = performance.now()
    probe.queries++
    try {
      const rows = await originalAll(sql, params)
      probe.rows += rows.length
      return rows
    } finally {
      probe.ms += performance.now() - started
    }
  }
  adapter.run = async (sql, params) => {
    const started = performance.now()
    probe.queries++
    try {
      return await originalRun(sql, params)
    } finally {
      probe.ms += performance.now() - started
    }
  }
  dbProbes.set(deployment, probe)
}

const boot = async (size: number, extensions: number): Promise<TestDeployment> => {
  const artifactsDir = join(
    runtimeDir,
    `${size}-${extensions}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  const deployment = await createTestDeployment(legoDeployment(extensions), {
    worker: false,
    artifactsDir,
    env: {
      KET_SQLITE: databasePath(size),
      KET_SECRET: 'lego-benchmark-local-secret',
      KET_QUEUE_NOTIFY: '0',
    },
  })
  instrumentDatabase(deployment)
  return deployment
}

const login = (deployment: TestDeployment) =>
  deployment.client.login({ login: 'bench-admin', password: 'lego-local-only' })

const pathFor = (mode: Mode, role: RoleFilter): string => {
  const query = new URLSearchParams({ prototype: mode })
  if (role === 'customer') query.set('role', 'customer')
  return `/admin/partner/partners?${query}`
}

const persistRaw = async (): Promise<void> => {
  await Promise.all([
    writeJson(join(rawDir, 'seeds.json'), seeds),
    writeJson(join(rawDir, 'server-samples.json'), serverSamples),
    writeJson(join(rawDir, 'browser-samples.json'), browserSamples),
    writeJson(join(rawDir, 'load-samples.json'), loadSamples),
  ])
}

const sqliteIndexes = async (adapter: Adapter, table: string) => {
  const indexes = await adapter.all(`PRAGMA index_list(${adapter.quoteIdent(table)})`)
  return Promise.all(
    indexes.map(async (index) => ({
      name: String(index.name),
      unique: Number(index.unique) === 1,
      fields: (await adapter.all(`PRAGMA index_info(${adapter.quoteIdent(String(index.name))})`))
        .sort((left, right) => Number(left.seqno) - Number(right.seqno))
        .map(({ name }) => String(name)),
    })),
  )
}

const databaseProfile = async (deployment: TestDeployment, size: number): Promise<void> => {
  const models = [
    'partner.Partner',
    'partner.Role',
    'lego_metric_data.Metric',
    'account.Move',
    'account.MoveLine',
  ]
  const profile = await deployment.fixture.withTenant('', async ({ adapter, manifest }) => {
    const tables = await Promise.all(
      models.map(async (model) => {
        const table = tableNameFor(model)
        const count = Number(
          (await adapter.all(`SELECT COUNT(*) AS count FROM ${adapter.quoteIdent(table)}`))[0]?.count,
        )
        return {
          model,
          table,
          rows: count,
          declaredIndexes: manifest.models[model]?.indexes ?? {},
          physicalIndexes: await sqliteIndexes(adapter, table),
        }
      }),
    )
    const plans = {
      partnerPage: await adapter.all(
        `EXPLAIN QUERY PLAN SELECT id, kind, name, ref, email, phone, active FROM partner_partner WHERE active = ? ORDER BY name ASC NULLS LAST LIMIT ? OFFSET ?`,
        [1, 30, 0],
      ),
      partnerRole: await adapter.all(`EXPLAIN QUERY PLAN SELECT partnerId FROM partner_role WHERE role = ?`, [
        'customer',
      ]),
      partnerBalance: await adapter.all(
        `EXPLAIN QUERY PLAN SELECT * FROM account_move_line WHERE companyId = ? AND partnerId IN (?, ?) AND reconciled = ?`,
        ['bench-company', 'bench-company-party', 'partner-000001', 0],
      ),
      extensionMetric: await adapter.all(
        `EXPLAIN QUERY PLAN SELECT * FROM lego_metric_data_metric WHERE partnerId IN (?, ?)`,
        ['bench-company-party', 'partner-000001'],
      ),
    }
    return { size, tables, plans }
  })
  await writeJson(join(rawDir, `database-profile-${size}.json`), profile)
}

const prepareDatabases = async (): Promise<void> => {
  for (const size of PARTNER_COUNTS) {
    const deployment = await boot(size, 10)
    try {
      const result = await seedLegoFixture(deployment, size)
      const bytes = (await stat(databasePath(size))).size
      seeds.push({ ...result, databaseBytes: bytes, path: databasePath(size) })
      await databaseProfile(deployment, size)
      console.log(
        `seeded ${size.toLocaleString()} partners in ${result.seedMs.toFixed(0)}ms (${bytes} bytes)`,
      )
    } finally {
      await deployment.close()
    }
    await persistRaw()
  }
}

const oneServerRequest = async (
  deployment: TestDeployment,
  size: number,
  extensions: number,
  role: RoleFilter,
  mode: Mode,
  temperature: ServerSample['temperature'],
  captureDiagnostics = true,
): Promise<ServerSample> => {
  const probe = dbProbes.get(deployment)
  if (captureDiagnostics && probe) Object.assign(probe, { queries: 0, ms: 0, rows: 0 })
  const cpuStarted = captureDiagnostics ? process.cpuUsage() : null
  const rssStarted = captureDiagnostics ? process.memoryUsage.rss() : 0
  const started = performance.now()
  const response = await deployment.client.get(pathFor(mode, role), { headers: { accept: 'text/html' } })
  const body = await response.arrayBuffer()
  const cpu = cpuStarted ? process.cpuUsage(cpuStarted) : null
  return {
    size,
    extensions,
    role,
    mode,
    temperature,
    durationMs: performance.now() - started,
    bytes: body.byteLength,
    status: response.status,
    ...(captureDiagnostics && probe ? { dbQueries: probe.queries, dbMs: probe.ms, dbRows: probe.rows } : {}),
    ...(cpu
      ? {
          cpuUserMs: cpu.user / 1_000,
          cpuSystemMs: cpu.system / 1_000,
          rssDeltaBytes: process.memoryUsage.rss() - rssStarted,
        }
      : {}),
  }
}

const measureServer = async (): Promise<void> => {
  const roles: RoleFilter[] = QUICK ? ['default'] : ['default', 'customer']
  for (const size of PARTNER_COUNTS) {
    for (const extensions of EXTENSION_COUNTS) {
      const deployment = await boot(size, extensions)
      try {
        await login(deployment)
        for (const role of roles) {
          for (const mode of MODES) {
            serverSamples.push(
              await oneServerRequest(deployment, size, extensions, role, mode, 'route-first'),
            )
            for (let at = 0; at < (QUICK ? 2 : SAMPLES); at++)
              serverSamples.push(await oneServerRequest(deployment, size, extensions, role, mode, 'warm'))
            const warm = serverSamples.filter(
              (sample) =>
                sample.size === size &&
                sample.extensions === extensions &&
                sample.role === role &&
                sample.mode === mode &&
                sample.temperature === 'warm',
            )
            console.log(
              `server size=${size} ext=${extensions} role=${role} mode=${mode} median=${distribution(warm.map(({ durationMs }) => durationMs)).median.toFixed(1)}ms`,
            )
            await persistRaw()
          }
        }
      } finally {
        await deployment.close()
      }
    }
  }
}

const measureLoad = async (): Promise<void> => {
  if (QUICK) return
  const size = 100_000
  const extensions = 10
  const deployment = await boot(size, extensions)
  try {
    await login(deployment)
    for (const mode of MODES) {
      for (const targetRate of [1, 10, 20]) {
        const count = 10
        const origin = performance.now()
        const pending: Promise<void>[] = []
        for (let at = 0; at < count; at++) {
          const due = origin + (at * 1_000) / targetRate
          const wait = Math.max(0, due - performance.now())
          if (wait) await new Promise((resolveWait) => setTimeout(resolveWait, wait))
          const startedAtMs = performance.now() - origin
          pending.push(
            oneServerRequest(deployment, size, extensions, 'default', mode, 'warm', false).then((sample) => {
              loadSamples.push({
                ...sample,
                targetRate,
                startedAtMs,
                completedAtMs: performance.now() - origin,
              })
            }),
          )
        }
        await Promise.all(pending)
        console.log(`load mode=${mode} target=${targetRate}/s completed=${count}`)
        await persistRaw()
      }
    }
  } finally {
    await deployment.close()
  }
}

type BrowserConfig = {
  class: BrowserSample['class']
  size: number
  extensions: number
  role: RoleFilter
  mode: Mode
  viewport: ViewportName
  rttMs: number
  samples: number
}

const browserConfigs = (): BrowserConfig[] => {
  const configs: BrowserConfig[] = []
  for (const size of PARTNER_COUNTS)
    for (const extensions of EXTENSION_COUNTS)
      for (const mode of MODES)
        configs.push({
          class: 'coverage',
          size,
          extensions,
          role: 'default',
          mode,
          viewport: 'desktop',
          rttMs: 0,
          samples: QUICK ? 1 : 3,
        })
  if (QUICK)
    return configs.filter(
      ({ size, extensions }) => size === PARTNER_COUNTS.at(-1) && extensions === EXTENSION_COUNTS.at(-1),
    )
  for (const size of PARTNER_COUNTS)
    for (const mode of MODES)
      configs.push({
        class: 'principal',
        size,
        extensions: 10,
        role: 'default',
        mode,
        viewport: 'desktop',
        rttMs: 120,
        samples: SAMPLES,
      })
  for (const role of ['customer'] as const)
    for (const viewport of ['desktop', 'mobile'] as const)
      for (const mode of MODES)
        configs.push({
          class: 'principal',
          size: 100_000,
          extensions: 10,
          role,
          mode,
          viewport,
          rttMs: 120,
          samples: SAMPLES,
        })
  for (const mode of MODES)
    configs.push({
      class: 'principal',
      size: 100_000,
      extensions: 10,
      role: 'default',
      mode,
      viewport: 'mobile',
      rttMs: 120,
      samples: SAMPLES,
    })
  for (const rttMs of [50, 250])
    for (const mode of MODES)
      configs.push({
        class: 'sensitivity',
        size: 100_000,
        extensions: 10,
        role: 'default',
        mode,
        viewport: 'desktop',
        rttMs,
        samples: 10,
      })
  return configs
}

const emulateRtt = async (context: BrowserContext, page: Page, rttMs: number): Promise<CDPSession> => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: rttMs,
    downloadThroughput: (100 * 1024 * 1024) / 8,
    uploadThroughput: (50 * 1024 * 1024) / 8,
    connectionType: rttMs >= 200 ? 'cellular4g' : 'wifi',
  })
  return cdp
}

const installObservers = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript(() => {
    const held = { lcp: 0, cls: 0, longTaskCount: 0, longTaskMs: 0 }
    ;(globalThis as typeof globalThis & { __legoPaint?: typeof held }).__legoPaint = held
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries()
        held.lcp = entries.at(-1)?.startTime ?? held.lcp
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { hadRecentInput?: boolean; value?: number }
        >)
          if (!entry.hadRecentInput) held.cls += entry.value ?? 0
      }).observe({ type: 'layout-shift', buffered: true })
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          held.longTaskCount++
          held.longTaskMs += entry.duration
        }
      }).observe({ type: 'longtask', buffered: true })
    } catch {
      // Older Chromium still provides navigation timing; paint metrics stay zero.
    }
  })
}

const waitForScreen = async (page: Page, mode: Mode, extensions: number): Promise<void> => {
  if (mode === 'ssr-current') await page.waitForSelector('[data-ui="row"]')
  else if (mode === 'ssr-matched') await page.waitForSelector('[data-lego-phase="complete"]')
  else {
    await page.waitForFunction(() => {
      const root = document.querySelector<HTMLElement>('[data-lego-bootstrap]')
      return Boolean(
        root?.dataset.legoFatal ||
          root?.dataset.legoWidgetError ||
          root?.querySelector('[data-lego-phase="complete"]'),
      )
    })
    if (extensions > 0)
      await page.waitForFunction(() => {
        const root = document.querySelector<HTMLElement>('[data-lego-bootstrap]')
        return Boolean(
          root?.dataset.legoFatal ||
            root?.dataset.legoWidgetError ||
            root?.querySelector('td[data-col="balance"] data'),
        )
      })
  }
  await page.waitForTimeout(40)
}

const browserMetrics = async (page: Page) =>
  page.evaluate(() => {
    const browserPerformance = globalThis.performance as unknown as {
      getEntriesByType(type: string): PerformanceEntry[]
      now(): number
      memory?: { usedJSHeapSize?: number }
    }
    const navigation = browserPerformance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    const resources = browserPerformance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const screen = document.querySelector<HTMLElement>('[data-lego-screen]')
    const root = document.querySelector<HTMLElement>('[data-lego-bootstrap]') ?? screen
    const paint = (
      globalThis as typeof globalThis & {
        __legoPaint?: { lcp: number; cls: number; longTaskCount: number; longTaskMs: number }
      }
    ).__legoPaint
    const dataResources = resources.filter(
      ({ name }) => name.includes('/_ket/fn/') || name.includes('/admin/partner/partners/browser-data'),
    )
    const starts = dataResources.map(({ startTime }) => startTime).sort((left, right) => left - right)
    let dataWaves = 0
    let waveStart = Number.NEGATIVE_INFINITY
    for (const started of starts) {
      if (started - waveStart > 20) {
        dataWaves++
        waveStart = started
      }
    }
    const fallbackComplete = navigation?.loadEventEnd || browserPerformance.now()
    const dataComplete = root?.dataset.legoCompleteMs ? Number(root.dataset.legoCompleteMs) : fallbackComplete
    const widgetComplete = root?.dataset.legoWidgetsMs ? Number(root.dataset.legoWidgetsMs) : 0
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0)
    const viewportWidth = document.documentElement.clientWidth
    const firstRow = document.querySelector<HTMLElement>('[data-ui="row"]')
    const tableScroll = document.querySelector<HTMLElement>('[data-ui="table-scroll"]')
    const visibleCells = firstRow
      ? [...firstRow.querySelectorAll<HTMLElement>('[data-ui="cell"]')].filter((cell) => {
          const style = getComputedStyle(cell)
          const box = cell.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
        }).length
      : 0
    return {
      ttfbMs: navigation?.responseStart,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd,
      loadMs: navigation?.loadEventEnd,
      coreMs: root?.dataset.legoPrimaryMs ? Number(root.dataset.legoPrimaryMs) : fallbackComplete,
      requiredMs: root?.dataset.legoRequiredMs ? Number(root.dataset.legoRequiredMs) : fallbackComplete,
      completeMs: Math.max(dataComplete, widgetComplete, navigation?.loadEventEnd ?? 0),
      lcpMs: paint?.lcp,
      cls: paint?.cls,
      transferBytes:
        Number(navigation?.transferSize ?? 0) + resources.reduce((sum, entry) => sum + entry.transferSize, 0),
      requestCount: 1 + resources.length,
      dataRequestCount: dataResources.length,
      dataWaves,
      decodedBytes:
        Number(navigation?.decodedBodySize ?? 0) +
        resources.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
      cacheHitCount: resources.filter(
        ({ transferSize, decodedBodySize }) => transferSize === 0 && decodedBodySize > 0,
      ).length,
      heapBytes: browserPerformance.memory?.usedJSHeapSize,
      longTaskCount: paint?.longTaskCount,
      longTaskMs: paint?.longTaskMs,
      hydrateMs: root?.dataset.legoHydrateMs ? Number(root.dataset.legoHydrateMs) : 0,
      renderMs: root?.dataset.legoRenderMs ? Number(root.dataset.legoRenderMs) : 0,
      rows: document.querySelectorAll('[data-ui="row"]').length,
      columns: document.querySelectorAll('th[data-ui="col"]').length,
      rowStable: root?.dataset.legoRowStable === undefined ? null : root.dataset.legoRowStable === 'true',
      viewportWidth,
      documentWidth,
      horizontalOverflowPx: Math.max(0, documentWidth - viewportWidth),
      tableClientWidth: tableScroll?.clientWidth ?? 0,
      tableScrollWidth: tableScroll?.scrollWidth ?? 0,
      tableOverflowPx: tableScroll ? Math.max(0, tableScroll.scrollWidth - tableScroll.clientWidth) : 0,
      tableResponsive: tableScroll?.dataset.responsive ?? null,
      firstRowHeight: firstRow?.getBoundingClientRect().height ?? 0,
      visibleCells,
      shellCount: document.querySelectorAll('[data-ui="shell"]').length,
      listPageCount: document.querySelectorAll('[data-ui="list-page"]').length,
      tabsCount: document.querySelectorAll('[data-ui="tabs"]').length,
      searchMenuCount: document.querySelectorAll('[data-ui="search-menu"]').length,
      bulkFormCount: document.querySelectorAll('[data-ui="bulk-form"]').length,
      selectAllCount: document.querySelectorAll('[data-ui="select-all"]').length,
      designSystemRoot: Boolean(document.querySelector('[data-kv-design-system]')),
      fatal: document.querySelector<HTMLElement>('[data-lego-bootstrap]')?.dataset.legoFatal,
      widgetError: document.querySelector<HTMLElement>('[data-lego-bootstrap]')?.dataset.legoWidgetError,
    }
  })

const measureBrowserGroup = async (
  browser: Browser,
  deployment: TestDeployment,
  config: BrowserConfig,
): Promise<void> => {
  const context = await browser.newContext({
    viewport: config.viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    deviceScaleFactor: config.viewport === 'mobile' ? 2 : 1,
    isMobile: config.viewport === 'mobile',
    colorScheme: config.viewport === 'mobile' ? 'dark' : 'light',
  })
  try {
    await context.request.post(`${deployment.baseUrl}/login`, {
      data: { login: 'bench-admin', password: 'lego-local-only' },
    })
    await installObservers(context)
    const page = await context.newPage()
    const browserErrors: string[] = []
    const pendingRequests = new Map<object, string>()
    page.on('pageerror', (error: Error) => browserErrors.push(`pageerror: ${error.message}`))
    page.on('console', (message: { type(): string; text(): string }) => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
    })
    page.on('request', (request: { url(): string }) => pendingRequests.set(request, request.url()))
    page.on('requestfinished', (request: object) => pendingRequests.delete(request))
    page.on('requestfailed', (request: { url(): string; failure(): { errorText?: string } | null }) => {
      pendingRequests.delete(request)
      browserErrors.push(`requestfailed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
    })
    await emulateRtt(context, page, config.rttMs)
    for (let at = -1; at < config.samples; at++) {
      const temperature = at < 0 ? 'cold-cache' : 'warm-cache'
      for (let attempt = 0; attempt < 3; attempt++) {
        browserErrors.length = 0
        pendingRequests.clear()
        try {
          const suffix = config.viewport === 'mobile' ? '&lang=en' : ''
          const response = await page.goto(
            `${deployment.baseUrl}${pathFor(config.mode, config.role)}${suffix}`,
            { waitUntil: 'domcontentloaded' },
          )
          if (!response?.ok()) throw new Error(`HTTP ${response?.status()}`)
          await page.waitForLoadState('load')
          await waitForScreen(page, config.mode, config.extensions)
          const measured = await browserMetrics(page)
          if (measured.fatal || measured.widgetError)
            throw new Error(measured.fatal ?? measured.widgetError ?? 'browser runtime failure')
          browserSamples.push({
            class: config.class,
            size: config.size,
            extensions: config.extensions,
            role: config.role,
            mode: config.mode,
            viewport: config.viewport,
            rttMs: config.rttMs,
            temperature,
            retries: attempt,
            ...measured,
          })
          break
        } catch (error) {
          const diagnostic = await page
            .evaluate(() => ({
              phase: document.querySelector<HTMLElement>('[data-lego-screen]')?.dataset.legoPhase,
              fatal: document.querySelector<HTMLElement>('[data-lego-bootstrap]')?.dataset.legoFatal,
              widgetError:
                document.querySelector<HTMLElement>('[data-lego-bootstrap]')?.dataset.legoWidgetError,
            }))
            .catch(() => ({}))
          const detail = [
            error instanceof Error ? error.message : String(error),
            JSON.stringify(diagnostic),
            `pending: ${JSON.stringify([...pendingRequests.values()])}`,
            ...browserErrors,
          ].join(' | ')
          browserSamples.push({
            class: config.class,
            size: config.size,
            extensions: config.extensions,
            role: config.role,
            mode: config.mode,
            viewport: config.viewport,
            rttMs: config.rttMs,
            temperature,
            retries: attempt,
            error: detail,
          })
          await persistRaw()
          if (attempt === 2) throw new Error(detail)
          await page.goto('about:blank', { waitUntil: 'commit', timeout: 5_000 }).catch(() => {})
        }
      }
    }
  } finally {
    await context.close()
  }
  const held = browserSamples.filter(
    (sample) =>
      sample.class === config.class &&
      sample.size === config.size &&
      sample.extensions === config.extensions &&
      sample.role === config.role &&
      sample.mode === config.mode &&
      sample.viewport === config.viewport &&
      sample.rttMs === config.rttMs &&
      sample.temperature === 'warm-cache',
  )
  console.log(
    `browser ${config.class} size=${config.size} ext=${config.extensions} ${config.role} ${config.mode} ${config.viewport} rtt=${config.rttMs} median=${distribution(held.map(({ completeMs }) => Number(completeMs))).median.toFixed(1)}ms`,
  )
  await persistRaw()
}

const readCdpStream = async (cdp: CDPSession, handle: string): Promise<string> => {
  let output = ''
  while (true) {
    const chunk = (await cdp.send('IO.read', { handle })) as { data: string; eof: boolean }
    output += chunk.data
    if (chunk.eof) break
  }
  await cdp.send('IO.close', { handle })
  return output
}

const sanitizeHar = async (path: string): Promise<void> => {
  const har = JSON.parse(await readFile(path, 'utf8')) as {
    log?: { entries?: Array<{ request?: Record<string, unknown>; response?: Record<string, unknown> }> }
  }
  for (const entry of har.log?.entries ?? []) {
    for (const side of [entry.request, entry.response]) {
      if (!side) continue
      if (Array.isArray(side.headers))
        side.headers = (side.headers as Array<{ name?: string }>).filter(
          ({ name }) => !['cookie', 'set-cookie', 'authorization'].includes(String(name).toLowerCase()),
        )
      if ('cookies' in side) side.cookies = []
    }
    if (entry.request && 'postData' in entry.request) entry.request.postData = { mimeType: 'redacted' }
  }
  await writeJson(path, har)
}

const captureEvidence = async (browser: Browser, deployment: TestDeployment): Promise<void> => {
  const extensions = 10
  for (const viewport of ['desktop', 'mobile'] as const) {
    for (const mode of MODES) {
      const stem = `${viewport}-${mode}`
      const harPath = join(evidenceDir, `${stem}.har`)
      const context = await browser.newContext({
        viewport: viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        deviceScaleFactor: viewport === 'mobile' ? 2 : 1,
        isMobile: viewport === 'mobile',
        colorScheme: viewport === 'mobile' ? 'dark' : 'light',
        recordHar: { path: harPath, mode: 'full', content: 'omit' },
      })
      try {
        await context.request.post(`${deployment.baseUrl}/login`, {
          data: { login: 'bench-admin', password: 'lego-local-only' },
        })
        const page = await context.newPage()
        const cdp = await emulateRtt(context, page, 120)
        await cdp.send('Tracing.start', {
          categories: 'devtools.timeline,blink.user_timing,loading,rail',
          transferMode: 'ReturnAsStream',
        })
        const suffix = viewport === 'mobile' ? '&lang=en' : ''
        await page.goto(`${deployment.baseUrl}${pathFor(mode, 'default')}${suffix}`, {
          waitUntil: 'domcontentloaded',
        })
        await page.waitForLoadState('load')
        await waitForScreen(page, mode, extensions)
        // Chromium's full-page compositor can omit client-inserted table layers
        // after the two-stage shell grows from a skeleton into thirty rows.
        // A fixed viewport captures what the operator actually sees; DOM metrics,
        // HAR and the trace retain evidence for the complete page and all rows.
        await page.screenshot({
          path: join(evidenceDir, `${stem}.png`),
          fullPage: false,
          animations: 'disabled',
        })
        const completed = new Promise<string>((resolveHandle, rejectHandle) =>
          cdp.once('Tracing.tracingComplete', ({ stream }) =>
            stream ? resolveHandle(stream) : rejectHandle(new Error('Chrome trace stream is missing')),
          ),
        )
        await cdp.send('Tracing.end')
        const handle = await completed
        await writeFile(join(evidenceDir, `${stem}.trace.json`), await readCdpStream(cdp, handle))
        await writeJson(join(evidenceDir, `${stem}.dom.json`), await browserMetrics(page))
      } finally {
        await context.close()
      }
      await sanitizeHar(harPath)
      console.log(`evidence ${stem} captured`)
    }
  }
}

const measureBrowser = async (): Promise<void> => {
  const moduleUrl = pathToFileURL(resolve('e2e/node_modules/playwright/index.mjs')).href
  const playwright: PlaywrightModule = await import(moduleUrl)
  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
    args: ['--disable-dev-shm-usage'],
  })
  try {
    const configs = browserConfigs()
    for (const size of PARTNER_COUNTS) {
      for (const extensions of EXTENSION_COUNTS) {
        const selected = configs.filter((config) => config.size === size && config.extensions === extensions)
        if (!selected.length) continue
        const deployment = await boot(size, extensions)
        try {
          for (const config of selected) await measureBrowserGroup(browser, deployment, config)
          if (size === 100_000 && extensions === 10) await captureEvidence(browser, deployment)
        } finally {
          await deployment.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
}

const writeSummaries = async (): Promise<void> => {
  const serverSummary = groupedSummary(
    serverSamples.filter(({ temperature }) => temperature === 'warm'),
    ['size', 'extensions', 'role', 'mode', 'temperature'],
    'durationMs',
  )
  const browserSummary = groupedSummary(
    browserSamples.filter(({ temperature, error }) => temperature === 'warm-cache' && !error),
    ['class', 'size', 'extensions', 'role', 'mode', 'viewport', 'rttMs', 'temperature'],
    'completeMs',
  )
  const serverDiagnostics = groupedMetricSummary(
    serverSamples.filter(({ temperature }) => temperature === 'warm'),
    ['size', 'extensions', 'role', 'mode', 'temperature'],
    ['durationMs', 'dbQueries', 'dbMs', 'dbRows', 'cpuUserMs', 'cpuSystemMs', 'rssDeltaBytes'],
  )
  const browserMilestones = groupedMetricSummary(
    browserSamples.filter(({ temperature, error }) => temperature === 'warm-cache' && !error),
    ['class', 'size', 'extensions', 'role', 'mode', 'viewport', 'rttMs', 'temperature'],
    [
      'coreMs',
      'requiredMs',
      'completeMs',
      'lcpMs',
      'transferBytes',
      'decodedBytes',
      'requestCount',
      'dataRequestCount',
      'dataWaves',
      'heapBytes',
      'longTaskMs',
      'hydrateMs',
      'renderMs',
    ],
  )
  const loadSummary = groupedSummary(loadSamples, ['size', 'extensions', 'mode', 'targetRate'], 'durationMs')
  const loadCapacity = groupedMetricSummary(
    loadSamples,
    ['size', 'extensions', 'mode', 'targetRate'],
    ['durationMs'],
  ).map((summary) => {
    const samples = loadSamples.filter(
      ({ size, extensions, mode, targetRate }) =>
        size === summary.size &&
        extensions === summary.extensions &&
        mode === summary.mode &&
        targetRate === summary.targetRate,
    )
    const durationMs = Math.max(0, ...samples.map(({ completedAtMs }) => completedAtMs))
    return {
      ...summary,
      offeredRequestsPerSecond: summary.targetRate,
      completed: samples.length,
      errors: samples.filter(({ status }) => status >= 400).length,
      durationMs,
      achievedRequestsPerSecond: durationMs ? samples.length / (durationMs / 1_000) : 0,
    }
  })
  await Promise.all([
    writeJson(join(runDir, 'server-summary.json'), serverSummary),
    writeFile(join(runDir, 'server-summary.csv'), csv(serverSummary)),
    writeJson(join(runDir, 'browser-summary.json'), browserSummary),
    writeFile(join(runDir, 'browser-summary.csv'), csv(browserSummary)),
    writeJson(join(runDir, 'server-diagnostics-summary.json'), serverDiagnostics),
    writeFile(join(runDir, 'server-diagnostics-summary.csv'), csv(serverDiagnostics)),
    writeJson(join(runDir, 'browser-milestones-summary.json'), browserMilestones),
    writeFile(join(runDir, 'browser-milestones-summary.csv'), csv(browserMilestones)),
    writeJson(join(runDir, 'load-summary.json'), loadSummary),
    writeFile(join(runDir, 'load-summary.csv'), csv(loadSummary)),
    writeJson(join(runDir, 'load-capacity-summary.json'), loadCapacity),
    writeFile(join(runDir, 'load-capacity-summary.csv'), csv(loadCapacity)),
  ])
}

await ensure()
await writeJson(join(runDir, 'metadata.json'), metadata())
await writeJson(join(root, 'latest.json'), { runId, runDir })
if (PHASE === 'all' || PHASE === 'seed') await prepareDatabases()
if (PHASE === 'all' || PHASE === 'server') await measureServer()
if (PHASE === 'all' || PHASE === 'load') await measureLoad()
if (PHASE === 'all' || PHASE === 'browser') await measureBrowser()
await persistRaw()
await writeSummaries()
await writeJson(join(runDir, 'completed.json'), { completedAt: new Date().toISOString() })
console.log(`lego CSR artifacts: ${runDir}`)
