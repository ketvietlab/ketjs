// The worker process role. It composes the same DeploymentSpec as HTTP, but opens no
// socket, builds no theme and reads no session. Jobs retain the tenant, actor and
// company scope captured when they were enqueued.

import { randomUUID } from 'node:crypto'
import { createAdapterPool } from '../data/pool.ts'
import { migrateOne } from '../data/fleet.ts'
import { createContext } from './ctx.ts'
import { sqliteStore } from './config.ts'
import { jobDefinition } from './jobs.ts'
import { createQueue, JOB_CHANNEL } from './queue.ts'
import { claimDue } from './schedule.ts'
import { KetError } from '../kernel/errors.ts'
import { bootRuntime } from './runtime.ts'
import { traceOf } from './log/index.ts'
import type { OpenLog } from './log/index.ts'
import { effectStorage, namespacedStorage, storageFromConfig } from './storage/index.ts'
import { effectTransport, unavailableTransport } from './transport/index.ts'
import type { DurableJob, Queue } from './queue.ts'
import type { DeploymentSpec } from '../kernel/workspace.ts'
import type { LogLevel } from './log/index.ts'
import type { Adapter, JobContext, Manifest } from '../types.ts'
import type { RuntimeConfig } from './config.ts'

export type WorkerLog = {
  event: 'started' | 'completed' | 'retrying' | 'discarded' | 'cancelled' | 'handler_ignored_abort'
  workerId: string
  tenant: string
  jobId: string
  job: string
  queue: string
  attempt: number
  durationMs?: number
  error?: string
  /**
   * The failure's stable code when it had one.
   *
   * Reducing a KetError to its message threw away the one part worth counting: a
   * record saying "E_UNEXPECTED" for a failure the system named and expected is a
   * record nobody can group or alert on.
   */
  errorCode?: string
}

export type BootedWorker = {
  workerId: string
  manifest: Manifest
  /** Claim one fair pass without starting a permanent loop. */
  runOnce(): Promise<number>
  /**
   * Move every due schedule forward once, and enqueue what moved. Returns how many
   * jobs were enqueued. `start()` does this on a timer; a test does it deliberately.
   */
  sweepSchedules(): Promise<number>
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

async function tenantSource(
  spec: DeploymentSpec,
  manifest: Manifest,
  config: RuntimeConfig,
): Promise<TenantSource> {
  const serve = spec.serve ?? {}
  const prepared = new WeakSet<Adapter>()

  const prepare = async (adapter: Adapter): Promise<Manifest> => {
    if (!prepared.has(adapter)) {
      if (config.migrateOnBoot) await migrateOne(adapter, manifest)
      prepared.add(adapter)
    }
    return manifest
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
    create: (key) => tenantSpec.open(key, config),
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
  spec: DeploymentSpec,
  options: {
    env?: Record<string, string | undefined>
    workerId?: string
    now?: () => Date
    random?: () => number
    log?: (entry: WorkerLog) => void
    /** Redirect this worker's operational records, without editing the spec. */
    openLog?: OpenLog
  } = {},
): Promise<BootedWorker> {
  if (!spec.worker || !Object.keys(spec.worker.queues).length)
    throw new Error(`deployment "${spec.name}" declares no worker queues`)

  const env = options.env ?? process.env
  const {
    config,
    manifest,
    log: sink,
    logger,
  } = await bootRuntime(spec, {
    env,
    role: 'worker',
    ...(options.openLog ? { openLog: options.openLog } : {}),
  })
  const baseStorage = await (spec.serve?.openStorage ?? storageFromConfig)(config)
  const baseTransport = await (spec.serve?.openTransport ?? unavailableTransport)(config)
  const storageFor = (tenant: string) => namespacedStorage(baseStorage, tenant || spec.name)

  const source = await tenantSource(spec, manifest, config)
  const queues = parseQueues(spec.worker.queues, env)
  const workerId = options.workerId ?? `${spec.name}-${process.pid}-${randomUUID().slice(0, 8)}`
  const now = options.now ?? (() => new Date())
  const random = options.random ?? Math.random
  /**
   * The worker's own events, on the deployment's sink.
   *
   * `WorkerLog` stays the internal shape and `options.log` keeps replacing it, so a
   * deployment that already intercepts these is unaffected. What changed is where
   * the default goes: one pipeline, redacted and level-filtered like everything
   * else, instead of a second private one on stdout.
   */
  const emit = (entry: WorkerLog): void => {
    const level: LogLevel =
      entry.event === 'discarded' || entry.event === 'handler_ignored_abort'
        ? 'error'
        : entry.event === 'retrying' || entry.event === 'cancelled'
          ? 'warn'
          : 'info'
    logger.child({ tenant: entry.tenant || null }).log({
      level,
      event: entry.event === 'handler_ignored_abort' ? 'job_ignored_abort' : `job_${entry.event}`,
      fn: entry.job,
      ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
      // Rebuilt so describeError sees a named failure rather than a bare string:
      // the code survived the WorkerLog boundary in its own field.
      ...(entry.error === undefined
        ? {}
        : {
            error: entry.errorCode
              ? new KetError({ code: entry.errorCode, message: entry.error })
              : entry.error,
          }),
      fields: {
        workerId: entry.workerId,
        jobId: entry.jobId,
        queue: entry.queue,
        attempt: entry.attempt,
      },
    })
  }
  const log = options.log ?? emit
  const pollMin = spec.worker.pollMinMs ?? 100
  const pollMax = spec.worker.pollMaxMs ?? 2_000
  const refreshMs = spec.worker.tenantRefreshMs ?? 60_000
  const sweepMs = Math.max(1_000, spec.worker.scheduleSweepMs ?? 30_000)
  const scheduled = Object.values(manifest.jobs).some((meta) => meta.schedule)
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
  let sweepTimer: ReturnType<typeof setInterval> | null = null
  let sweeping: Promise<unknown> | null = null
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
        log: logger.child({
          tenant: tenant.key || null,
          fn: job.job,
          actor: traceOf(job.actor, config.secret),
          company: job.scope?.company ?? null,
          // The job's own id, hashed like any other correlation: every record from
          // one attempt shares it. It is deliberately not the trace of the request
          // that enqueued the job — the queue does not carry a correlation column,
          // so claiming otherwise here would be a lie a dashboard would believe.
          trace: traceOf(job.id, config.secret),
        }),
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
        storage: effectStorage(storageFor(tenant.key), meta.effects, job.job),
        transport: effectTransport(baseTransport, meta.effects, job.job),
      }) as JobContext
      await definition.handler(context, job.args)
      if (timedOut || controller.signal.aborted) {
        log({
          event: 'handler_ignored_abort',
          workerId,
          tenant: tenant.key,
          jobId: job.id,
          job: job.job,
          queue: job.queue,
          attempt: job.attempt,
          durationMs: now().getTime() - started,
          error: String(controller.signal.reason ?? 'job aborted'),
        })
        throw controller.signal.reason ?? new Error('job aborted')
      }
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
      const errorCode = error instanceof KetError ? { errorCode: error.code } : {}
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
          ...errorCode,
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
          ...errorCode,
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

  /**
   * Move every due schedule forward, in every tenant, and enqueue what moved.
   *
   * Claim first, enqueue second: a crash between the two loses one tick rather than
   * running it twice, which is the right way round for anything that touches money.
   * A tenant that throws does not stop the rest — one broken database is not a
   * reason for every other tenant to stop keeping time.
   */
  const sweepSchedules = async (): Promise<number> => {
    if (!scheduled || closing) return 0
    await refresh()
    let fired = 0
    for (const key of tenantKeys) {
      if (closing) break
      const at = logger.child({ tenant: key || null })
      try {
        await source.with(key, async (tenant) => {
          const claims = await claimDue(tenant.adapter, tenant.live, {
            now: now(),
            timezone: config.defaultTimezone,
          })
          if (!claims.length) return
          const queue = await createQueue(tenant.adapter, { notify: config.queueNotify })
          for (const claim of claims) {
            const meta = tenant.live.jobs[claim.job]
            if (!meta) continue
            await queue.enqueue(
              claim.job,
              {},
              {
                queue: meta.queue,
                maxAttempts: meta.maxAttempts,
                actor: null,
                // No company: the framework knows which tenants exist and does not
                // know what a company is. A job with per-company work declares
                // crossCompany, reads them, and enqueues per company from there.
                scope: { company: null, companies: null, branch: null, branches: null },
                uniqueKey: `schedule:${claim.tick}`,
              },
            )
            fired += 1
            at.log({
              level: 'info',
              event: 'schedule_fired',
              fn: claim.job,
              fields: { tick: claim.tick, skipped: claim.skipped },
            })
          }
        })
      } catch (error) {
        at.error('schedule_error', error)
      }
    }
    return fired
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
          logger.error('worker_tick_error', error, { workerId })
          return 0
        })
        idle = claimed ? pollMin : Math.min(pollMax, Math.max(pollMin, idle * 2))
        if (!closing) await waitForWake(idle)
      }
    })()
    if (scheduled && !sweepTimer) {
      // Its own timer rather than a step in the poll loop: the poll loop backs off
      // to two seconds when there is nothing to do, and a schedule that only fires
      // when the queue is busy is not a schedule.
      sweepTimer = setInterval(() => {
        // Held so that close() can wait for it. A sweep still running when the
        // tenant source shuts under it would fail on a closed pool and report an
        // error that is really just the process stopping.
        sweeping = sweepSchedules()
          .catch((error) => logger.error('schedule_error', error, { workerId }))
          .finally(() => {
            sweeping = null
          })
      }, sweepMs)
      sweepTimer.unref?.()
    }
  }

  if (source.singleAdapter?.notifications?.subscribe && config.queueNotify) {
    try {
      unsubscribe = await source.singleAdapter.notifications.subscribe(JOB_CHANNEL, wake, wake)
    } catch (error) {
      logger.log({
        level: 'warn',
        event: 'queue_notifier_unavailable',
        error,
        fields: { workerId, fallback: 'polling' },
      })
    }
  }

  return {
    workerId,
    sweepSchedules,
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
      if (sweepTimer) clearInterval(sweepTimer)
      await sweeping
      await unsubscribe?.()
      await source.close()
      await baseTransport.close?.()
      logger.info('shutdown', { workerId })
      await sink.flush?.()
      await sink.close?.()
    },
  }
}

export async function serveWorker(
  spec: DeploymentSpec,
  options: Parameters<typeof bootWorker>[1] = {},
): Promise<BootedWorker> {
  const worker = await bootWorker(spec, options)
  worker.start()
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => void worker.close().then(() => process.exit(0)))
  return worker
}
