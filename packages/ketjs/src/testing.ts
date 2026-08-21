// Headless end-to-end testing.
//
// This deliberately goes through bootApp and HTTP. Calling callFn directly is a
// useful integration test, but it skips request parsing, tenant resolution,
// sessions, permissions and response serialization — the exact seams an end-to-
// end test exists to exercise.

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { bootApp, type BootedApp } from './server/boot.ts'
import { bootWorker, type BootedWorker } from './server/worker.ts'
import type { WorkerLog } from './server/worker.ts'
import { callFn, type CallResult } from './server/fn.ts'
import type { AppSpec } from './kernel/workspace.ts'
import type { AppRegistry } from './kernel/apps.ts'
import type { Adapter, Manifest, Scope } from './types.ts'

export type TestIdentity = {
  /** The company new rows are written to. Ignored by apps using sessions. */
  company?: string | null
  /** Other companies a read may include. The write company is included automatically. */
  companies?: readonly string[] | null
  /** The operational branch new company+branch rows are written to. */
  branch?: string | null
  /** Operational branches visible to this client. */
  branches?: readonly string[] | null
  /** Conventional test tenant header. Override tenantHeader for another resolver. */
  tenant?: string | null
  tenantHeader?: string
  locale?: string | null
  headers?: HeadersInit
}

export type TestClientOptions = TestIdentity & {
  jar?: CookieJar
  /** Follow redirects while retaining cookies set by intermediate responses. */
  followRedirects?: boolean
  maxRedirects?: number
}

export type TestCallOptions = {
  dryRun?: boolean
  idempotencyKey?: string
  headers?: HeadersInit
  signal?: AbortSignal
}

const setHeader = (headers: Headers, name: string, value: string | readonly string[] | null | undefined) => {
  if (value === null || value === undefined) headers.delete(name)
  else headers.set(name, Array.isArray(value) ? value.join(',') : String(value))
}

/** A small, deterministic cookie jar for one test user. */
export class CookieJar {
  readonly #cookies = new Map<string, string>()

  constructor(initial: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(initial)) this.set(name, value)
  }

  set(name: string, value: string): void {
    if (!name || /[;=\s]/.test(name)) throw new Error(`invalid cookie name "${name}"`)
    this.#cookies.set(name, value)
  }

  delete(name: string): void {
    this.#cookies.delete(name)
  }

  clear(): void {
    this.#cookies.clear()
  }

  get(name: string): string | undefined {
    return this.#cookies.get(name)
  }

  get size(): number {
    return this.#cookies.size
  }

  header(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries([...this.#cookies].sort(([a], [b]) => a.localeCompare(b)))
  }

  clone(): CookieJar {
    return new CookieJar(this.toJSON())
  }

  /** Capture every Set-Cookie header before a redirect is followed. */
  capture(headers: Headers): void {
    const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
    const values =
      withGetSetCookie.getSetCookie?.() ?? (headers.get('set-cookie') ? [headers.get('set-cookie')!] : [])
    for (const value of values) this.captureOne(value)
  }

  private captureOne(header: string): void {
    const parts = header.split(';').map((part) => part.trim())
    const first = parts.shift() ?? ''
    const separator = first.indexOf('=')
    if (separator <= 0) return
    const name = first.slice(0, separator)
    const value = first.slice(separator + 1)
    const attributes = new Map<string, string>()
    for (const part of parts) {
      const at = part.indexOf('=')
      attributes.set((at < 0 ? part : part.slice(0, at)).toLowerCase(), at < 0 ? '' : part.slice(at + 1))
    }
    const maxAge = attributes.get('max-age')
    const expires = attributes.get('expires')
    const expired =
      maxAge === '0' ||
      (expires !== undefined && Number.isFinite(Date.parse(expires)) && Date.parse(expires) <= Date.now())
    if (expired || value === '') this.delete(name)
    else this.set(name, value)
  }

  async save(path: string): Promise<void> {
    await mkdir(dirname(resolve(path)), { recursive: true })
    await writeFile(path, JSON.stringify(this.toJSON(), null, 2) + '\n', { mode: 0o600 })
    await chmod(path, 0o600)
  }

  static async load(path: string): Promise<CookieJar> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('cookie file must contain a JSON object')
      const values: Record<string, string> = {}
      for (const [name, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') throw new Error(`cookie "${name}" must be a string`)
        values[name] = value
      }
      return new CookieJar(values)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new CookieJar()
      throw error
    }
  }
}

export class TestHttpError extends Error {
  readonly status: number
  readonly response: Response
  readonly body: unknown

  constructor(response: Response, body: unknown) {
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `${response.status} ${response.statusText}`
    super(message)
    this.name = 'TestHttpError'
    this.status = response.status
    this.response = response
    this.body = body
  }
}

const responseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  if (!text) return null
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('json')) {
    try {
      return JSON.parse(text) as unknown
    } catch {
      // A malformed JSON response is still useful evidence in the thrown error.
    }
  }
  return text
}

const redirectStatus = new Set([301, 302, 303, 307, 308])

/** A real HTTP client with isolated identity and a persistent cookie jar. */
export class TestClient {
  readonly baseUrl: string
  readonly jar: CookieJar
  readonly #headers: Headers
  readonly #followRedirects: boolean
  readonly #maxRedirects: number
  readonly #identity: TestIdentity

  constructor(baseUrl: string | URL, options: TestClientOptions = {}) {
    const url = new URL(baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new Error(`test client needs an http(s) URL, got ${url.protocol}`)
    this.baseUrl = url.toString()
    this.jar = options.jar ?? new CookieJar()
    this.#followRedirects = options.followRedirects ?? true
    this.#maxRedirects = options.maxRedirects ?? 10
    this.#identity = {
      company: options.company,
      companies: options.companies,
      branch: options.branch,
      branches: options.branches,
      tenant: options.tenant,
      tenantHeader: options.tenantHeader,
      locale: options.locale,
    }
    this.#headers = new Headers(options.headers)
    this.applyIdentity(this.#headers, this.#identity)
  }

  private applyIdentity(headers: Headers, identity: TestIdentity): void {
    setHeader(headers, 'x-ket-company', identity.company)
    const companies = identity.companies ? [...identity.companies] : identity.companies
    if (companies && identity.company && !companies.includes(identity.company))
      companies.unshift(identity.company)
    setHeader(headers, 'x-ket-companies', companies)
    setHeader(headers, 'x-ket-current-branch', identity.branch)
    setHeader(headers, 'x-ket-branch', identity.branches)
    setHeader(headers, identity.tenantHeader ?? 'x-tenant', identity.tenant)
    setHeader(headers, 'accept-language', identity.locale)
    for (const [name, value] of new Headers(identity.headers)) headers.set(name, value)
  }

  /** A client for the same logged-in user with a narrowed/overridden request identity. */
  with(options: TestClientOptions = {}): TestClient {
    const merged: TestClientOptions = {
      ...this.#identity,
      ...options,
      headers: new Headers(this.#headers),
      jar: options.jar ?? this.jar,
      followRedirects: options.followRedirects ?? this.#followRedirects,
      maxRedirects: options.maxRedirects ?? this.#maxRedirects,
    }
    if (options.headers) {
      const headers = new Headers(merged.headers)
      for (const [name, value] of new Headers(options.headers)) headers.set(name, value)
      merged.headers = headers
    }
    return new TestClient(this.baseUrl, merged)
  }

  as(identity: TestIdentity): TestClient {
    return this.with(identity)
  }

  /** A client at the same endpoint with no cookies. */
  anonymous(identity: TestIdentity = {}): TestClient {
    return this.with({ ...identity, jar: new CookieJar() })
  }

  async request(path: string | URL, init: RequestInit = {}): Promise<Response> {
    let url = path instanceof URL ? path : new URL(path, this.baseUrl)
    if (url.origin !== new URL(this.baseUrl).origin)
      throw new Error(`test client refuses a cross-origin request to ${url.origin}`)
    let method = (init.method ?? 'GET').toUpperCase()
    let body = init.body
    const headers = new Headers(this.#headers)
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value)
    let redirects = 0

    while (true) {
      const sent = new Headers(headers)
      const cookie = this.jar.header()
      if (cookie && !sent.has('cookie')) sent.set('cookie', cookie)
      const response = await fetch(url, {
        ...init,
        method,
        body,
        headers: sent,
        redirect: 'manual',
      })
      this.jar.capture(response.headers)

      const location = response.headers.get('location')
      const follows = init.redirect !== 'manual' && this.#followRedirects
      if (!follows || !location || !redirectStatus.has(response.status)) return response
      if (init.redirect === 'error') throw new Error(`redirect refused: ${response.status} ${location}`)
      if (redirects++ >= this.#maxRedirects) throw new Error(`too many redirects (${this.#maxRedirects})`)

      const next = new URL(location, url)
      // Identity headers and this intentionally small cookie jar belong to this
      // app. Return an external OAuth redirect to the test rather than leak either.
      if (next.origin !== new URL(this.baseUrl).origin) return response
      await response.body?.cancel()
      url = next
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === 'POST')
      ) {
        method = 'GET'
        body = undefined
        headers.delete('content-type')
        headers.delete('content-length')
      }
    }
  }

  get(path: string | URL, init: RequestInit = {}): Promise<Response> {
    return this.request(path, { ...init, method: 'GET' })
  }

  post(path: string | URL, body?: BodyInit | null, init: RequestInit = {}): Promise<Response> {
    return this.request(path, { ...init, method: 'POST', body })
  }

  async json<T>(path: string | URL, body?: unknown, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('content-type', 'application/json')
    const response = await this.request(path, {
      ...init,
      method: init.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const parsed = await responseBody(response.clone())
    if (!response.ok) throw new TestHttpError(response, parsed)
    return parsed as T
  }

  async form<T>(path: string | URL, values: Record<string, string>, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('content-type', 'application/x-www-form-urlencoded')
    const response = await this.request(path, {
      ...init,
      method: init.method ?? 'POST',
      headers,
      body: new URLSearchParams(values),
    })
    const parsed = await responseBody(response.clone())
    if (!response.ok) throw new TestHttpError(response, parsed)
    return parsed as T
  }

  async call<T = unknown>(
    name: string,
    input: Record<string, unknown> = {},
    options: TestCallOptions = {},
  ): Promise<CallResult & { value: T }> {
    const path = new URL(`/_ket/fn/${encodeURIComponent(name)}`, this.baseUrl)
    if (options.dryRun) path.searchParams.set('dryRun', '1')
    const headers = new Headers(options.headers)
    headers.set('content-type', 'application/json')
    if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey)
    const response = await this.request(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: options.signal,
    })
    const parsed = await responseBody(response.clone())
    if (!response.ok) throw new TestHttpError(response, parsed)
    return parsed as CallResult & { value: T }
  }

  login<T = unknown>(credentials: Record<string, unknown>, path = '/login'): Promise<T> {
    return this.json<T>(path, credentials, { method: 'POST' })
  }

  logout<T = unknown>(path = '/logout'): Promise<T> {
    return this.json<T>(path, {}, { method: 'POST' })
  }
}

export type CreateTestAppOptions = {
  /** Explicit runtime variables. Host process variables are ignored unless inheritEnv is true. */
  env?: Record<string, string | undefined>
  inheritEnv?: boolean
  /** A caller-owned directory. It is never removed by close(). */
  artifactsDir?: string
  /** Keep the automatically-created database and storage for debugging. */
  keepArtifacts?: boolean
  /** Boot a worker handle when the app declares queues. Defaults to true. */
  worker?: boolean
  /** Harness progress. Silent by default so test reporter output stays readable. */
  log?: (line: string) => void
  workerLog?: (entry: WorkerLog) => void
  client?: TestClientOptions
  port?: number
}

export type TestFixtureCallOptions = {
  tenant?: string
  scope?: Scope
  actor?: string | null
  allow?: readonly string[] | null
  dryRun?: boolean
  idempotencyKey?: string | null
}

export type TestFixtureTenant = {
  key: string
  adapter: Adapter
  manifest: Manifest
  apps: AppRegistry
}

export type TestFixtures = {
  /**
   * Seed through a declared function without HTTP identity checks.
   *
   * Keep business actions under test on TestClient. This channel is deliberately
   * named fixture so bypassing the public boundary cannot look accidental.
   */
  call<T = unknown>(
    name: string,
    input?: Record<string, unknown>,
    options?: TestFixtureCallOptions,
  ): Promise<CallResult & { value: T }>
  /** Direct datastore access for fixtures and invariants that have no public function. */
  withTenant<T>(tenant: string, fn: (tenant: TestFixtureTenant) => Promise<T>): Promise<T>
}

export type TestApp = {
  app: BootedApp
  worker: BootedWorker | null
  client: TestClient
  baseUrl: string
  adapter: Adapter | null
  artifactsDir: string
  databasePath: string | null
  env: Readonly<Record<string, string | undefined>>
  fixture: TestFixtures
  drainJobs(): Promise<number>
  close(): Promise<void>
}

/**
 * Boot a real app on an ephemeral port with isolated database and storage.
 *
 * No browser is involved, but every TestClient call crosses the real HTTP
 * boundary. The host environment is ignored by default so a developer cannot
 * accidentally point an end-to-end suite at their normal or production database.
 */
export async function createTestApp(spec: AppSpec, options: CreateTestAppOptions = {}): Promise<TestApp> {
  const ownedArtifacts = options.artifactsDir === undefined
  const artifactsDir = options.artifactsDir
    ? isAbsolute(options.artifactsDir)
      ? options.artifactsDir
      : resolve(options.artifactsDir)
    : await mkdtemp(join(tmpdir(), `ket-e2e-${spec.name}-`))
  await mkdir(artifactsDir, { recursive: true })

  const env: Record<string, string | undefined> = {
    ...(options.inheritEnv ? process.env : {}),
    ...options.env,
  }
  let databasePath: string | null = null
  if (!env.DATABASE_URL && !env.KET_SQLITE) {
    databasePath = join(artifactsDir, `${spec.name}.db`)
    env.KET_SQLITE = databasePath
  } else if (!env.DATABASE_URL && env.KET_SQLITE && env.KET_SQLITE !== ':memory:') {
    databasePath = isAbsolute(env.KET_SQLITE) ? env.KET_SQLITE : resolve(env.KET_SQLITE)
  }
  env.KET_STORAGE_DIR ??= join(artifactsDir, 'storage')
  env.KET_SECRET ??= `ket-e2e-${spec.name}`
  env.KET_QUEUE_NOTIFY ??= '0'

  let app: BootedApp | null = null
  let worker: BootedWorker | null = null
  try {
    app = await bootApp(spec, { env, port: options.port ?? 0, log: options.log ?? (() => {}) })
    const wantsWorker = options.worker ?? true
    if (wantsWorker && spec.worker)
      worker = await bootWorker(spec, { env, log: options.workerLog ?? (() => {}) })
  } catch (error) {
    await worker?.close().catch(() => {})
    await app?.close().catch(() => {})
    if (ownedArtifacts && !options.keepArtifacts) await rm(artifactsDir, { recursive: true, force: true })
    throw error
  }

  const booted = app
  const baseUrl = `http://127.0.0.1:${booted.port}`
  const client = new TestClient(baseUrl, options.client)
  let closed = false

  const fixture: TestFixtures = {
    withTenant: (tenant, fn) =>
      booted.tenants.with(tenant, (selected) =>
        fn({ key: selected.key, adapter: selected.adapter, manifest: selected.live, apps: selected.apps }),
      ),
    call: async <T = unknown>(
      name: string,
      input: Record<string, unknown> = {},
      callOptions: TestFixtureCallOptions = {},
    ) => {
      if (booted.adapter === null && callOptions.tenant === undefined)
        throw new Error(`fixture call on multi-tenant app "${spec.name}" requires options.tenant`)
      return booted.tenants.with(
        callOptions.tenant ?? '',
        async (selected) =>
          callFn(name, input, {
            adapter: selected.adapter,
            manifest: selected.live,
            scope: callOptions.scope,
            actor: callOptions.actor,
            allow: callOptions.allow,
            dryRun: callOptions.dryRun,
            idempotencyKey: callOptions.idempotencyKey,
            queueNotify: false,
          }) as Promise<CallResult & { value: T }>,
      )
    },
  }

  return {
    app: booted,
    worker,
    client,
    baseUrl,
    adapter: booted.adapter,
    artifactsDir,
    databasePath,
    env: Object.freeze({ ...env }),
    fixture,
    async drainJobs() {
      if (!worker) throw new Error(`app "${spec.name}" has no test worker`)
      return worker.drain()
    },
    async close() {
      if (closed) return
      closed = true
      const errors: unknown[] = []
      if (worker) await worker.close().catch((error) => errors.push(error))
      await booted.close().catch((error) => errors.push(error))
      if (ownedArtifacts && !options.keepArtifacts)
        await rm(artifactsDir, { recursive: true, force: true }).catch((error) => errors.push(error))
      if (errors.length) throw new AggregateError(errors, `failed to close test app "${spec.name}"`)
    },
  }
}
