// Server composition contract. Import explicitly; the browser entry never loads it.
// The host owns authentication, tenant scope, replay/CAS and the database transaction.
export function createFlowServerExtensions(extensions = []) {
  const names = new Set(),
    commands = new Map()
  for (const extension of extensions) {
    if (!extension.name || names.has(extension.name))
      throw new Error('Duplicate or missing Flow server extension name')
    names.add(extension.name)
    for (const [name, command] of Object.entries(extension.commands ?? {})) {
      if (commands.has(name) || !command.capability || typeof command.run !== 'function')
        throw new Error(`Invalid or duplicate Flow command ${name}`)
      commands.set(name, command)
    }
  }
  const chain = [...extensions]
  let disposed = false
  const active = () => {
    if (disposed) throw new Error('Flow server extensions are disposed')
  }
  return Object.freeze({
    // Guards run for core writes too. Every guard must pass before any write starts.
    async mutate(context, mutation, write) {
      active()
      if (
        !mutation.capability ||
        typeof context.requireCapability !== 'function' ||
        typeof context.transaction !== 'function'
      )
        throw new Error('Flow mutations require a scoped transaction and capability check')
      await context.requireCapability(mutation.capability, mutation.input)
      return context.transaction(async (scoped) => {
        active()
        for (const extension of chain) await extension.beforeMutation?.(scoped, mutation)
        return write(scoped)
      })
    },
    async dispatch(context, name, input) {
      active()
      const command = commands.get(name)
      if (!command) return { handled: false }
      const value = await this.mutate(context, { name, input, capability: command.capability }, (scoped) =>
        command.run(scoped, input),
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
      if (errors.length) throw new AggregateError(errors, 'Flow server extension cleanup failed')
    },
  })
}
