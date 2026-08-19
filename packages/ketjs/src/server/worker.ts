// The worker process role. It composes the same AppSpec as HTTP, but opens no
// socket, builds no theme and reads no session. Jobs retain the tenant, actor and
// company scope captured when they were enqueued.

import { randomUUID } from 'node:crypto'
import { createAppRegistry, restrictManifest } from '../kernel/apps.ts'
import { createAdapterPool } from '../data/pool.ts'
import { migrateOne } from '../data/fleet.ts'
import { createContext } from './ctx.ts'
import { sqliteStore } from './config.ts'
import { jobDefinition } from './jobs.ts'
import { createQueue, JOB_CHANNEL } from './queue.ts'
import { bootRuntime } from './runtime.ts'
import type { DurableJob, Queue } from './queue.ts'
import type { AppSpec } from '../kernel/workspace.ts'
import type { Adapter, JobContext, Manifest } from '../types.ts'
import type { RuntimeConfig } from './config.ts'

export type WorkerLog = {
  event: 'started' | 'completed' | 'retrying' | 'discarded' | 'cancelled'
  workerId: string
  tenant: string
  jobId: string
  job: string
  queue: string
  attempt: number
  durationMs?: number
  error?: string
}

export type BootedWorker = {
  workerId: string
  manifest: Manifest
  /** Claim one fair pass without starting a permanent loop. */
  runOnce(): Promise<number>
  /** Keep claiming until no due work and all claimed jobs have settled. */
  drain(): Promise<number>
  /** Start adaptive polling. Idempotent. */
  start(): void
  close(): Promise<void>
}

type WorkerTenant = { key: string; adapter: Adapter; live: Manifest }
type TenantSource = {
  keys(): Promise<string[]>
  with<T>(key: string, fn: (tenant: WorkerTenant) => Promise<T>): Promise<T>
  singleAdapter: Adapter | null
  close(): Promise<void>
}

const parseQueues = (configured: Record<string, number>, env: Record<string, string | undefined>) => {
  const value = env.KET_WORKER_QUEUES
  if (!value) return configured
  const queues: Record<string, number> = {}
  for (const item of value.split(',')) {
    const [name, raw] = item.split(':')
    const concurrency = Number(raw)
    if (!name || !/^[a-z][a-z0-9_-]*$/.test(name) || !Number.isInteger(concurrency) || concurrency < 1)
      throw new Error(`invalid KET_WORKER_QUEUES item "${item}" (expected name:positive-integer)`)
    queues[name] = concurrency
  }
  return queues
}

async function tenantSource(spec: AppSpec, manifest: Manifest, config: RuntimeConfig): Promise<TenantSource> {
  const serve = spec.serve ?? {}
  const bootstrap = config.bootstrapApps ?? serve.bootstrap ?? []
  const registries = new WeakMap<Adapter, Awaited<ReturnType<typeof createAppRegistry>>>()

  const prepare = async (adapter: Adapter): Promise<Manifest> => {
    let registry = registries.get(adapter)
    if (!registry) {
      if (config.migrateOnBoot) await migrateOne(adapter, manifest)
      registry = await createAppRegistry(manifest, adapter, { autoInstall: config.autoInstall })
      if (bootstrap.length && (await registry.enabled()).size === 0)
        for (const name of bootstrap) await registry.install(name)
      registries.set(adapter, registry)
    }
    return restrictManifest(manifest, await registry.enabled())
  }

  if (!serve.tenants) {
    const adapter = await (serve.openStore ?? sqliteStore)(config)
    await prepare(adapter)
    return {
      keys: async () => [''],
      with: async (_key, fn) => fn({ key: '', adapter, live: await prepare(adapter) }),
      singleAdapter: adapter,
      close: () => adapter.close(),
    }
  }

  const tenantSpec = serve.tenants
  const pool = createAdapterPool({
    create: (key) => tenantSpec.open(key, config) as Adapter,
    ...(tenantSpec.max === undefined ? {} : { max: tenantSpec.max }),
    ...(tenantSpec.idleMs === undefined ? {} : { idleMs: tenantSpec.idleMs }),
  })
  return {
    keys: () => tenantSpec.list(),
    with: (key, fn) => pool.with(key, async (adapter) => fn({ key, adapter, live: await prepare(adapter) })),
    singleAdapter: null,
    close: () => pool.close(),
  }
}

export async function bootWorker(
  spec: AppSpec,
  options: {
    env?: Record<string, string | undefined>
    workerId?: string
    now?: () => Date
    random?: () => number
    log?: (entry: WorkerLog) => void
  } = {},
): Promise<BootedWorker> {
  if (!spec.worker || !Object.keys(spec.worker.queues).length)
    throw new Error(`app "${spec.name}" declares no worker queues`)

  const env = options.env ?? process.env
  const { config, manifest } = await bootRuntime(spec, { env })

  const source = await tenantSource(spec, manifest, config)
  const queues = parseQueues(spec.worker.queues, env)
  const workerId = options.workerId ?? `${spec.name}-${process.pid}-${randomUUID().slice(0, 8)}`
  const now = options.now ?? (() => new Date())
  const random = options.random ?? Math.random
  const log = options.log ?? ((entry: WorkerLog) => console.log(JSON.stringify(entry)))
  const pollMin = spec.worker.pollMinMs ?? 100
  const pollMax = spec.worker.pollMaxMs ?? 2_000
  const refreshMs = spec.worker.tenantRefreshMs ?? 60_000
  const leaseMs = spec.worker.leaseMs ?? 60_000
  const shutdownGrace = spec.worker.shutdownGraceMs ?? 15_000
  const maxConcurrency = spec.serve?.tenants ? (spec.serve.tenants.max ?? 32) : Infinity

  let tenantKeys: string[] = []
  let refreshedAt = 0
  let cursor = 0
  let running = false
  let closing = false
  let loop: Promise<void> | null = null
  let unsubscribe: (() => Promise<void>) | null = null
  let wakeResolve: (() => void) | null = null
  const inFlight = new Set<Promise<void>>()
  const controllers = new Map<string, AbortController>()
  const active = new Map<string, number>()
  const rescuedAt = new Map<string, number>()
  const totalActive = () => [...active.values()].reduce((sum, count) => sum + count, 0)

  const refresh = async () => {
    if (tenantKeys.length && now().getTime() - refreshedAt < refreshMs) return
    tenantKeys = [...new Set(await source.keys())].sort()
    refreshedAt = now().getTime()
    if (cursor >= tenantKeys.length) cursor = 0
  }

  const wake = () => {
    wakeResolve?.()
    wakeResolve = null
  }

  const waitForWake = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (wakeResolve === done) wakeResolve = null
        resolve()
      }, ms)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      wakeResolve = done
    })

  const retryAt = (attempt: number): Date => {
    const ceiling = Math.min(3_600_000, 1_000 * 2 ** Math.max(0, attempt - 1))
    return new Date(now().getTime() + Math.floor(random() * ceiling))
  }

  const execute = async (tenant: WorkerTenant, queue: Queue, job: DurableJob): Promise<void> => {
    const started = now().getTime()
    const definition = jobDefinition(job.job)
    const meta = tenant.live.jobs[job.job]
    if (!definition || !meta) {
      await queue.discard(
        job.id,
        new Error(`job "${job.job}" is unknown or its module is disabled`),
        workerId,
      )
      log({
        event: 'discarded',
        workerId,
        tenant: tenant.key,
        jobId: job.id,
        job: job.job,
        queue: job.queue,
        attempt: job.attempt,
        error: 'unknown or disabled job',
      })
      return
    }

    const controller = new AbortController()
    controllers.set(job.id, controller)
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort(new Error(`job timed out after ${meta.timeoutMs}ms`))
    }, meta.timeoutMs)
    const heartbeat = setInterval(
      () => {
        void queue.heartbeat(job.id, workerId, leaseMs).then((held) => {
          if (!held) controller.abort(new Error('job lease was lost or cancelled'))
        })
      },
      Math.max(1_000, Math.floor(leaseMs / 3)),
    )

    log({
      event: 'started',
      workerId,
      tenant: tenant.key,
      jobId: job.id,
      job: job.job,
      queue: job.queue,
      attempt: job.attempt,
    })

    try {
      const base = createContext({
        adapter: tenant.adapter,
        manifest: tenant.live,
        fnKey: job.job,
        kind: 'job',
        actor: job.actor,
        scope: job.scope,
        queueNotify: config.queueNotify,
      })
      const context = Object.assign(base, {
        job: {
          id: job.id,
          key: job.job,
          queue: job.queue,
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
        },
        signal: controller.signal,
      }) as JobContext
      await definition.handler(context, job.args)
      if (timedOut || controller.signal.aborted) throw controller.signal.reason ?? new Error('job aborted')
      if (!(await queue.complete(job.id, workerId))) {
        log({
          event: 'cancelled',
          workerId,
          tenant: tenant.key,
          jobId: job.id,
          job: job.job,
          queue: job.queue,
          attempt: job.attempt,
          durationMs: now().getTime() - started,
        })
        return
      }
      log({
        event: 'completed',
        workerId,
        tenant: tenant.key,
        jobId: job.id,
        job: job.job,
        queue: job.queue,
        attempt: job.attempt,
        durationMs: now().getTime() - started,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (job.attempt >= job.maxAttempts) {
        const changed = await queue.discard(job.id, error, workerId)
        if (!changed) {
          log({
            event: 'cancelled',
            workerId,
            tenant: tenant.key,
            jobId: job.id,
            job: job.job,
            queue: job.queue,
            attempt: job.attempt,
            durationMs: now().getTime() - started,
          })
          return
        }
        log({
          event: 'discarded',
          workerId,
          tenant: tenant.key,
          jobId: job.id,
          job: job.job,
          queue: job.queue,
          attempt: job.attempt,
          durationMs: now().getTime() - started,
          error: message,
        })
      } else {
        const changed = await queue.retry(job.id, error, retryAt(job.attempt), workerId)
        if (!changed) {
          log({
            event: 'cancelled',
            workerId,
            tenant: tenant.key,
            jobId: job.id,
            job: job.job,
            queue: job.queue,
            attempt: job.attempt,
            durationMs: now().getTime() - started,
          })
          return
        }
        log({
          event: 'retrying',
          workerId,
          tenant: tenant.key,
          jobId: job.id,
          job: job.job,
          queue: job.queue,
          attempt: job.attempt,
          durationMs: now().getTime() - started,
          error: message,
        })
      }
    } finally {
      clearTimeout(timeout)
      clearInterval(heartbeat)
      controllers.delete(job.id)
    }
  }

  const startClaimed = (tenantKey: string, queueName: string, jobs: DurableJob[]) => {
    for (const job of jobs) {
      active.set(queueName, (active.get(queueName) ?? 0) + 1)
      let task: Promise<void>
      task = source
        .with(tenantKey, async (tenant) => execute(tenant, await createQueue(tenant.adapter), job))
        .catch((error) => {
          console.error(
            JSON.stringify({ event: 'worker_error', workerId, tenant: tenantKey, error: String(error) }),
          )
        })
        .finally(() => {
          active.set(queueName, Math.max(0, (active.get(queueName) ?? 1) - 1))
          inFlight.delete(task)
          wake()
        })
      inFlight.add(task)
    }
  }

  const runOnce = async (): Promise<number> => {
    if (closing) return 0
    await refresh()
    if (!tenantKeys.length) return 0
    let claimed = 0
    const ordered = [...tenantKeys.slice(cursor), ...tenantKeys.slice(0, cursor)]
    cursor = (cursor + 1) % tenantKeys.length
    for (const key of ordered) {
      if (closing || totalActive() >= maxConcurrency) break
      await source.with(key, async (tenant) => {
        const queue = await createQueue(tenant.adapter)
        if (now().getTime() - (rescuedAt.get(key) ?? 0) >= Math.max(1_000, Math.floor(leaseMs / 3))) {
          await queue.rescue()
          rescuedAt.set(key, now().getTime())
        }
        for (const [name, limit] of Object.entries(queues)) {
          const room = Math.min(limit - (active.get(name) ?? 0), maxConcurrency - totalActive())
          if (room <= 0) continue
          const jobs = await queue.claimBatch(name, {
            workerId,
            leaseMs,
            limit: Math.min(10, room),
          })
          claimed += jobs.length
          startClaimed(key, name, jobs)
        }
      })
    }
    return claimed
  }

  const drain = async (): Promise<number> => {
    let total = 0
    for (;;) {
      const count = await runOnce()
      total += count
      if (inFlight.size) await Promise.allSettled([...inFlight])
      if (count === 0) return total
    }
  }

  const start = () => {
    if (running || closing) return
    running = true
    loop = (async () => {
      let idle = pollMin
      while (!closing) {
        const claimed = await runOnce().catch((error) => {
          console.error(JSON.stringify({ event: 'worker_tick_error', workerId, error: String(error) }))
          return 0
        })
        idle = claimed ? pollMin : Math.min(pollMax, Math.max(pollMin, idle * 2))
        if (!closing) await waitForWake(idle)
      }
    })()
  }

  if (source.singleAdapter?.notifications?.subscribe && config.queueNotify) {
    try {
      unsubscribe = await source.singleAdapter.notifications.subscribe(JOB_CHANNEL, wake, wake)
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'queue_notifier_unavailable',
          workerId,
          error: String(error),
          fallback: 'polling',
        }),
      )
    }
  }

  return {
    workerId,
    manifest,
    runOnce,
    drain,
    start,
    async close() {
      if (closing) return
      closing = true
      wake()
      if (loop) await loop
      const settled = Promise.allSettled([...inFlight]).then(() => undefined)
      let graceful = false
      let graceTimer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        settled.then(() => {
          graceful = true
        }),
        new Promise<void>((resolve) => {
          graceTimer = setTimeout(resolve, shutdownGrace)
        }),
      ])
      if (graceTimer) clearTimeout(graceTimer)
      if (!graceful)
        for (const controller of controllers.values()) controller.abort(new Error('worker shutting down'))
      await unsubscribe?.()
      await source.close()
    },
  }
}

export async function serveWorker(
  spec: AppSpec,
  options: Parameters<typeof bootWorker>[1] = {},
): Promise<BootedWorker> {
  const worker = await bootWorker(spec, options)
  worker.start()
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => void worker.close().then(() => process.exit(0)))
  return worker
}
