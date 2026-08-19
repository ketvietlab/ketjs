// The atom. One declaration yields an HTTP endpoint, a typed client method, a
// manifest entry, an agent tool descriptor and a dry-runnable test handle.
// Written once, never restated.

import { createContext } from './ctx.ts'
import { createIdempotency } from './idem.ts'
import { KetError } from '../kernel/errors.ts'
import { project } from './project.ts'
import { parseType } from '../kernel/types.ts'
import type { Adapter, Ctx, FnSpec, KetModule, Manifest, WriteRecord } from '../types.ts'

export type CallResult = {
  ok: true
  value: unknown
  writes: WriteRecord[]
  dryRun: boolean
  replayed?: boolean
}

const registry = new Map<string, FnSpec>()

export function defineFn(spec: FnSpec): FnSpec {
  if (typeof spec.handler !== 'function')
    throw new KetError({ code: 'E_FN_NO_HANDLER', message: 'defineFn() requires a handler' })
  return spec
}

export function registerFunctions(modules: KetModule[]): Map<string, FnSpec> {
  registry.clear()
  for (const m of modules)
    for (const [name, def] of Object.entries(m.functions)) registry.set(`${m.name}.${name}`, def)
  return registry
}

const JS_OF: Record<string, string> = {
  id: 'string',
  text: 'string',
  ref: 'string',
  int: 'number',
  float: 'number',
  bool: 'boolean',
  datetime: 'string',
  json: 'object',
}

export function validateInput(fnKey: string, manifest: Manifest, args: Record<string, unknown>): void {
  const sig = manifest.functions[fnKey]?.input ?? {}
  const errors: string[] = []
  for (const [name, tspec] of Object.entries(sig)) {
    const t = parseType(tspec)
    const v = args?.[name]
    if (v == null) {
      if (t.ok && !t.optional) errors.push(`missing required input "${name}" (${tspec})`)
      continue
    }
    if (!t.ok) continue
    const want = JS_OF[t.base]
    if (want && typeof v !== want) errors.push(`input "${name}" expects ${t.base} (${want}), got ${typeof v}`)
    if (t.base === 'int' && typeof v === 'number' && !Number.isInteger(v))
      errors.push(`input "${name}" expects an integer`)
  }
  for (const k of Object.keys(args ?? {})) {
    if (!(k in sig)) errors.push(`unknown input "${k}" (accepted: ${Object.keys(sig).join(', ') || 'none'})`)
  }
  if (errors.length) {
    throw new KetError({
      code: 'E_INVALID_INPUT',
      message: `${fnKey}: ${errors.join('; ')}`,
      hint: `signature: ${JSON.stringify(sig)}`,
    })
  }
}

// Idempotency records are durable and shared between instances: a process-local
// Map loses them on restart and is invisible to a second instance, which makes the
// guarantee false exactly when it matters.
type Idem = Awaited<ReturnType<typeof createIdempotency>>
const stores = new WeakMap<Adapter, Promise<Idem>>()
const idemFor = (adapter: Adapter): Promise<Idem> => {
  let p = stores.get(adapter)
  if (!p) {
    p = createIdempotency(adapter)
    stores.set(adapter, p)
  }
  return p
}
export const _resetIdempotency = (): void => {
  /* records are durable; nothing to clear */
}

export async function callFn(
  fnKey: string,
  args: Record<string, unknown>,
  o: {
    adapter: Adapter
    manifest: Manifest
    dryRun?: boolean
    actor?: string | null
    idempotencyKey?: string | null
    scope?: import('../types.ts').Scope
    /**
     * The functions this caller may invoke. Undefined or null means unrestricted,
     * which is what an internal call, a migration or a test is — the check exists
     * for requests carrying an identity, and a caller with no identity has no
     * business being narrowed by one.
     *
     * A list rather than a predicate so that it can be printed, diffed and stored.
     * The framework enforces it; which list a user gets is the app's decision, the
     * same split as the datastore driver.
     */
    allow?: readonly string[] | null
  },
): Promise<CallResult> {
  const def = registry.get(fnKey)
  const owner = fnKey.split('.')[0] as string
  if (o.manifest.disabledModules?.includes(owner)) {
    throw new KetError({
      code: 'E_APP_NOT_INSTALLED',
      module: owner,
      message: `"${fnKey}" belongs to "${owner}", which is not installed on this database`,
      hint: `install "${owner}" first — the code ships with this deployment, it is simply switched off here`,
    })
  }
  if (!def)
    throw new KetError({
      code: 'E_UNKNOWN_FUNCTION',
      message: `no server function "${fnKey}"`,
      hint: `known: ${[...registry.keys()].join(', ')}`,
    })

  // Permission is checked before the input is validated, so a caller who may not
  // call this at all learns that and nothing else — not which arguments it takes,
  // and not whether the ones they guessed were right.
  if (o.allow && !o.allow.includes(fnKey)) {
    throw new KetError({
      code: 'E_FN_NOT_PERMITTED',
      module: owner,
      message: `this caller may not call "${fnKey}"`,
      hint: 'grant a role that includes it — `ket permissions --grant` shows what any set of functions reaches',
    })
  }
  validateInput(fnKey, o.manifest, args)

  const meta = o.manifest.functions[fnKey]!
  const dryRun = o.dryRun ?? false

  const idemKey = o.idempotencyKey ? `${fnKey}:${o.idempotencyKey}` : null
  let idem: Idem | null = null

  if (idemKey) {
    if (!meta.idempotent) {
      throw new KetError({
        code: 'E_NOT_IDEMPOTENT',
        message: `"${fnKey}" is not declared idempotent but was called with an idempotency key`,
        hint: 'declare `idempotent: true` on the function, or drop the key',
      })
    }
    idem = await idemFor(o.adapter)
    // Claim the key before doing any work. Losing the race means another caller is
    // either mid-flight or already finished, and both are answered from the record.
    const claimed = await idem.claim(idemKey, fnKey)
    if (!claimed) {
      const existing = await idem.read(idemKey)
      if (existing?.state === 'done') return { ...(existing.result as CallResult), replayed: true }
      throw new KetError({
        code: 'E_IDEMPOTENCY_IN_FLIGHT',
        message: `"${fnKey}" is already running with idempotency key "${o.idempotencyKey}"`,
        hint: 'retry shortly; the first call has not finished yet',
      })
    }
  }
  if (dryRun && !meta.dryRun)
    throw new KetError({ code: 'E_NO_DRY_RUN', message: `"${fnKey}" does not support dry-run` })

  const ctx: Ctx = createContext({
    adapter: o.adapter,
    manifest: o.manifest,
    fnKey,
    dryRun,
    actor: o.actor ?? null,
    scope: o.scope,
  })

  let result: CallResult
  try {
    const value = project(fnKey, meta.output, await def.handler(ctx, args ?? {}))
    result = { ok: true, value, writes: ctx.writes, dryRun }
  } catch (e) {
    // A claim whose call then failed must not wedge the key forever.
    if (idemKey && idem) await idem.release(idemKey)
    throw e
  }

  if (idemKey && idem) await idem.complete(idemKey, result)
  return result
}
