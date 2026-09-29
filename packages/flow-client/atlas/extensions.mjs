// Simulator extension injection. Product code must never import this module.
export function atlasExtensions(extensions = []) {
  if (new Set(extensions.map((x) => x.name)).size !== extensions.length)
    throw new Error('Duplicate Atlas extension')
  return {
    notify(hook, ...args) {
      for (const x of extensions) x[hook]?.(...args)
    },
    first(hook, ...args) {
      for (const x of extensions) {
        const value = x[hook]?.(...args)
        if (value !== undefined) return value
      }
    },
    values(hook, ...args) {
      return extensions.flatMap((x) => x[hook]?.(...args) ?? [])
    },
  }
}
