// The atom. One declaration yields an HTTP endpoint, a typed client method, a
// manifest entry, an agent tool descriptor and a dry-runnable test handle.
// Written once, never restated.

import { createContext } from './ctx.ts'
import { createLog } from './log.ts'
import type { Log } from './log.ts'
import { KetError } from '../kernel/errors.ts'
import { parseType } from '../kernel/types.ts'
import type { Adapter, Ctx, FnSpec, KetModule, Manifest, WriteRecord } from '../types.ts'

export type CallResult = { ok: true; value: unknown; writes: WriteRecord[]; dryRun: boolean; replayed?: boolean }

const registry = new Map<string, FnSpec>()

export function defineFn(spec: FnSpec): FnSpec {
  if (typeof spec.handler !== 'function') throw new KetError({ code: 'E_FN_NO_HANDLER', message: 'defineFn() requires a handler' })
  return spec
}

export function registerFunctions(modules: KetModule[]): Map<string, FnSpec> {
  registry.clear()
  for (const m of modules) for (const [name, def] of Object.entries(m.functions)) registry.set(`${m.name}.${name}`, def)
  return registry
}

const JS_OF: Record<string, string> = { id: 'string', text: 'string', ref: 'string', int: 'number', float: 'number', bool: 'boolean', datetime: 'string', json: 'object' }

export function validateInput(fnKey: string, manifest: Manifest, args: Record<string, unknown>): void {
  const sig = manifest.functions[fnKey]?.input ?? {}
  const errors: string[] = []
  for (const [name, tspec] of Object.entries(sig)) {
    const t = parseType(tspec)
    const v = args?.[name]
    if (v == null) { if (t.ok && !t.optional) errors.push(`missing required input "${name}" (${tspec})`); continue }
    if (!t.ok) continue
    const want = JS_OF[t.base]
    if (want && typeof v !== want) errors.push(`input "${name}" expects ${t.base} (${want}), got ${typeof v}`)
    if (t.base === 'int' && typeof v === 'number' && !Number.isInteger(v)) errors.push(`input "${name}" expects an integer`)
  }
  for (const k of Object.keys(args ?? {})) {
    if (!(k in sig)) errors.push(`unknown input "${k}" (accepted: ${Object.keys(sig).join(', ') || 'none'})`)
  }
  if (errors.length) {
    throw new KetError({ code: 'E_INVALID_INPUT', message: `${fnKey}: ${errors.join('; ')}`, hint: `signature: ${JSON.stringify(sig)}` })
  }
}

// Idempotency records live in the log, not in a process-local Map: they have to
// survive a restart and be visible to every instance, which a Map is not.
const logs = new WeakMap<Adapter, Promise<Log>>()
const logFor = (adapter: Adapter): Promise<Log> => {
  let p = logs.get(adapter)
  if (!p) { p = createLog(adapter); logs.set(adapter, p) }
  return p
}
export const _resetIdempotency = (): void => { /* records are durable; nothing to clear */ }

export async function callFn(
  fnKey: string,
  args: Record<string, unknown>,
  o: { adapter: Adapter; manifest: Manifest; dryRun?: boolean; actor?: string | null; idempotencyKey?: string | null },
): Promise<CallResult> {
  const def = registry.get(fnKey)
  if (!def) throw new KetError({ code: 'E_UNKNOWN_FUNCTION', message: `no server function "${fnKey}"`, hint: `known: ${[...registry.keys()].join(', ')}` })
  validateInput(fnKey, o.manifest, args)

  const meta = o.manifest.functions[fnKey]!
  const dryRun = o.dryRun ?? false

  const idemTopic = o.idempotencyKey ? `idem:${fnKey}:${o.idempotencyKey}` : null
  let log: Log | null = null

  if (idemTopic) {
    if (!meta.idempotent) {
      throw new KetError({
        code: 'E_NOT_IDEMPOTENT',
        message: `"${fnKey}" is not declared idempotent but was called with an idempotency key`,
        hint: 'declare `idempotent: true` on the function, or drop the key',
      })
    }
    log = await logFor(o.adapter)
    // Claim the key before doing any work. Losing the race means another caller is
    // either mid-flight or already finished, and both are answered from the record.
    const claimed = await log.putOnce(idemTopic, 'idem', null)
    if (!claimed) {
      const existing = await log.readOne(idemTopic)
      if (existing?.state === 'done') return { ...(existing.data as CallResult), replayed: true }
      throw new KetError({
        code: 'E_IDEMPOTENCY_IN_FLIGHT',
        message: `"${fnKey}" is already running with idempotency key "${o.idempotencyKey}"`,
        hint: 'retry shortly; the first call has not finished yet',
      })
    }
  }
  if (dryRun && !meta.dryRun) throw new KetError({ code: 'E_NO_DRY_RUN', message: `"${fnKey}" does not support dry-run` })

  const ctx: Ctx = createContext({ adapter: o.adapter, manifest: o.manifest, fnKey, dryRun, actor: o.actor ?? null })
  const value = await def.handler(ctx, args ?? {})
  const result: CallResult = { ok: true, value, writes: ctx.writes, dryRun }

  if (idemTopic && log) await log.complete(idemTopic, result)
  return result
}
