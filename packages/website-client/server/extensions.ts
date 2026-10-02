// Server composition contract for Website Studio, the same shape as Flow's. Import explicitly; the
// browser entry never loads it. The host owns authentication, company/site scope, idempotency,
// revision CAS and the database transaction. Extensions add commands and queries, and may veto any
// write (core or extension) in `beforeMutation`; they never bypass the host's checks.

/** `C` is the host's scoped context: what an operation and a guard receive inside the transaction. */
export type WebsiteServerOperation<C> = { capability: string; run: (scoped: C, input: unknown) => unknown }
export type WebsiteMutation = { name: string; input: unknown; capability: string }
export type WebsiteServerExtension<C> = {
  name: string
  commands?: Record<string, WebsiteServerOperation<C>>
  queries?: Record<string, WebsiteServerOperation<C>>
  beforeMutation?: (scoped: C, mutation: WebsiteMutation) => unknown
  dispose?: () => unknown
}
/** What the host lends a write: its capability check and its transaction. */
export type WebsiteHostContext<C> = {
  requireCapability: (capability: string, input: unknown) => unknown
  transaction: <T>(run: (scoped: C) => Promise<T>) => Promise<T>
}

/**
 * Namespaces the core owns. Hosts dispatch extensions before core handlers, so an extension that
 * could register `website.saveEntry` would replace the core write and skip its checks.
 */
export const CORE_NAMESPACES: readonly string[] = Object.freeze(['website', 'website_studio', 'website_form'])

export function createWebsiteServerExtensions<C>(extensions: WebsiteServerExtension<C>[] = []) {
  const names = new Set<string>()
  const operations = new Map<string, WebsiteServerOperation<C> & { kind: string }>()
  for (const extension of extensions) {
    if (!extension.name || names.has(extension.name))
      throw new Error('Duplicate or missing Website server extension name')
    names.add(extension.name)
    for (const [kind, table] of [
      ['command', extension.commands],
      ['query', extension.queries],
    ] as const)
      for (const [name, operation] of Object.entries(table ?? {})) {
        if (operations.has(name) || !operation.capability || typeof operation.run !== 'function')
          throw new Error(`Invalid or duplicate Website ${kind} ${name}`)
        if (CORE_NAMESPACES.includes(name.split('.')[0]))
          throw new Error(`Website ${kind} ${name} uses a core namespace`)
        operations.set(name, { kind, ...operation })
      }
  }
  const chain = [...extensions]
  let disposed = false
  const active = () => {
    if (disposed) throw new Error('Website server extensions are disposed')
  }
  return Object.freeze({
    has: (name: string) => operations.has(name),
    // Guards run for core writes too. Every guard must pass before any write starts.
    async mutate<T>(
      context: WebsiteHostContext<C>,
      mutation: WebsiteMutation,
      write: (scoped: C) => T | Promise<T>,
    ): Promise<T> {
      active()
      if (
        !mutation.capability ||
        typeof context.requireCapability !== 'function' ||
        typeof context.transaction !== 'function'
      )
        throw new Error('Website mutations require a scoped transaction and capability check')
      await context.requireCapability(mutation.capability, mutation.input)
      return context.transaction(async (scoped) => {
        active()
        for (const extension of chain) await extension.beforeMutation?.(scoped, mutation)
        return write(scoped)
      })
    },
    async dispatch(
      context: C & WebsiteHostContext<C>,
      name: string,
      input: unknown,
    ): Promise<{ handled: false } | { handled: true; value: unknown }> {
      active()
      const operation = operations.get(name)
      if (!operation) return { handled: false }
      if (operation.kind === 'query') {
        await context.requireCapability(operation.capability, input)
        return { handled: true, value: await operation.run(context, input) }
      }
      const value = await this.mutate(context, { name, input, capability: operation.capability }, (scoped) =>
        operation.run(scoped, input),
      )
      return { handled: true, value }
    },
    async dispose() {
      if (disposed) return
      disposed = true
      const results = await Promise.allSettled(
        [...chain].reverse().map((x) => Promise.resolve().then(() => x.dispose?.())),
      )
      const errors = results.filter((x) => x.status === 'rejected').map((x) => x.reason)
      if (errors.length) throw new AggregateError(errors, 'Website server extension cleanup failed')
    },
  })
}
